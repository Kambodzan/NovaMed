# Testy adapterów HTTP integracji (warstwa „mock-first, production-swappable").
# Adaptery wołają httpx na poziomie modułu — podmieniamy httpx.post/get/request na
# rekorder z programowalną odpowiedzią, żeby sprawdzić mapowanie kontraktu i ścieżki
# błędów (IntegrationError vs best-effort) bez realnego HTTP.
from datetime import date
from types import SimpleNamespace

import httpx
import pytest

from app.integrations import email as em
from app.integrations import ewus, lab, p1, payments, push, sms, zus
from app.integrations.base import IntegrationError


class FakeResp:
    def __init__(self, status=200, data=None, text=""):
        self.status_code = status
        self._data = data
        self.text = text

    def json(self):
        if self._data is None:
            raise ValueError("brak JSON")
        return self._data


@pytest.fixture()
def http(monkeypatch):
    """Rekorder wywołań httpx z programowalną odpowiedzią (rec.next: FakeResp,
    wyjątek do podniesienia, albo callable(url)->FakeResp)."""
    rec = SimpleNamespace(calls=[], next=FakeResp(200, {}))

    def _resolve(url):
        r = rec.next
        if isinstance(r, Exception):
            raise r
        if callable(r):
            return r(url)
        return r

    def post(url, *a, **kw):
        rec.calls.append(SimpleNamespace(method="POST", url=url, json=kw.get("json"), data=kw.get("data")))
        return _resolve(url)

    def get(url, *a, **kw):
        rec.calls.append(SimpleNamespace(method="GET", url=url, json=None, data=None))
        return _resolve(url)

    def request(method, url, *a, **kw):
        rec.calls.append(SimpleNamespace(method=method, url=url, json=kw.get("json"), data=None))
        return _resolve(url)

    monkeypatch.setattr(httpx, "post", post)
    monkeypatch.setattr(httpx, "get", get)
    monkeypatch.setattr(httpx, "request", request)
    return rec


# ---------------------------------------------------------------- eWUŚ
def test_ewus_verify_zwraca_status(http):
    http.next = FakeResp(200, {"insured": True})
    assert ewus.HttpEwusClient().verify(pesel="47030812344") is True
    assert http.calls[-1].json == {"pesel": "47030812344"}
    http.next = FakeResp(200, {"insured": False})
    assert ewus.HttpEwusClient().verify(pesel="x") is False


def test_ewus_blad_i_brak_polaczenia(http):
    http.next = FakeResp(500, text="err")
    with pytest.raises(IntegrationError):
        ewus.HttpEwusClient().verify(pesel="x")
    http.next = httpx.ConnectError("down")
    with pytest.raises(IntegrationError):
        ewus.HttpEwusClient().verify(pesel="x")


# ---------------------------------------------------------------- laboratorium
def test_lab_create_order_idempotencja_i_bledy(http):
    c = lab.HttpLabClient()
    http.next = FakeResp(201)
    c.create_order(pesel="1", referral_code="R", test_type="MORF")  # OK
    http.next = FakeResp(409)
    c.create_order(pesel="1", referral_code="R", test_type="MORF")  # 409 = już zlecone, brak wyjątku
    http.next = FakeResp(400, text="bad")
    with pytest.raises(IntegrationError):
        c.create_order(pesel="1", referral_code="R", test_type="MORF")
    http.next = httpx.ConnectError("down")
    with pytest.raises(IntegrationError):
        c.create_order(pesel="1", referral_code="R", test_type="MORF")


def test_lab_fetch_results_i_ack(http):
    c = lab.HttpLabClient()
    http.next = FakeResp(200, [{"referral_code": "R", "result": "ok"}])
    assert c.fetch_ready_results() == [{"referral_code": "R", "result": "ok"}]
    http.next = FakeResp(500)
    with pytest.raises(IntegrationError):
        c.fetch_ready_results()
    http.next = httpx.ConnectError("down")
    with pytest.raises(IntegrationError):
        c.fetch_ready_results()
    # acknowledge jest best-effort — błąd połączenia jest połykany
    http.next = httpx.ConnectError("down")
    c.acknowledge("R")  # brak wyjątku
    http.next = FakeResp(200)
    c.acknowledge("R")


# ---------------------------------------------------------------- P1
def test_p1_wystawianie_i_mapowanie_kodow(http):
    c = p1.HttpP1Client()
    http.next = FakeResp(200, {"prescription_code": "RX-1"})
    assert c.issue_prescription(pesel="1", doctor_pwz="9", icd10="J00", drugs="x") == "RX-1"
    http.next = FakeResp(200, {"referral_code": "SK-1"})
    assert c.issue_referral(pesel="1", doctor_pwz="9", icd10=None, referral_type="SPECIALIST", notes=None) == "SK-1"
    http.next = FakeResp(200, {})
    c.revoke_document(code="RX-1")
    c.consume_referral(code="SK-1")
    c.register_external_referral(code="EXT", pesel="1", specialization="Kardiolog")


def test_p1_verify_referral_404_zwraca_none(http):
    c = p1.HttpP1Client()
    http.next = FakeResp(200, {"type": "referral", "used": False})
    assert c.verify_referral(code="SK")["type"] == "referral"
    http.next = FakeResp(404)
    assert c.verify_referral(code="NIEMA") is None
    http.next = FakeResp(500)
    with pytest.raises(IntegrationError):
        c.verify_referral(code="SK")
    http.next = httpx.ConnectError("down")
    with pytest.raises(IntegrationError):
        c.verify_referral(code="SK")


def test_p1_blad_detail_json_i_tekst(http):
    c = p1.HttpP1Client()
    http.next = FakeResp(400, {"detail": "PESEL niezgodny"})
    with pytest.raises(IntegrationError, match="PESEL niezgodny"):
        c.issue_prescription(pesel="1", doctor_pwz="9", icd10=None, drugs="x")
    http.next = FakeResp(400, text="surowy błąd")  # body bez JSON-a → fallback na text
    with pytest.raises(IntegrationError, match="surowy błąd"):
        c.issue_prescription(pesel="1", doctor_pwz="9", icd10=None, drugs="x")
    http.next = httpx.ConnectError("down")
    with pytest.raises(IntegrationError):
        c.issue_prescription(pesel="1", doctor_pwz="9", icd10=None, drugs="x")


# ---------------------------------------------------------------- płatności
def test_payments_pelny_cykl(http):
    c = payments.HttpPaymentsClient()
    http.next = FakeResp(200, {"payment_id": "PAY-1"})
    assert c.create_payment(amount=120.0, reference="A") == "PAY-1"
    http.next = FakeResp(200, {"status": "PAID"})
    assert c.confirm(provider_ref="PAY-1", outcome="success") == "PAID"
    http.next = FakeResp(200, {"status": "PAID"})
    assert c.get_status(provider_ref="PAY-1") == "PAID"
    http.next = FakeResp(200, {"invoice_number": "FV/2026/00001"})
    assert c.issue_invoice(amount=120.0, reference="A", buyer="Jan") == "FV/2026/00001"


def test_payments_bledy(http):
    c = payments.HttpPaymentsClient()
    http.next = FakeResp(402, {"detail": "odmowa"})
    with pytest.raises(IntegrationError, match="odmowa"):
        c.create_payment(amount=1.0, reference="A")
    http.next = FakeResp(500, text="awaria")
    with pytest.raises(IntegrationError, match="awaria"):
        c.create_payment(amount=1.0, reference="A")
    http.next = httpx.ConnectError("down")
    with pytest.raises(IntegrationError):
        c.create_payment(amount=1.0, reference="A")


# ---------------------------------------------------------------- ZUS e-ZLA
def test_zus_wystawienie_i_anulowanie(http):
    c = zus.HttpZusClient()
    http.next = FakeResp(200, {"sick_leave_code": "ZLA-1"})
    code = c.issue_sick_leave(pesel="1", doctor_pwz="9", date_from=date(2026, 6, 1),
                              date_to=date(2026, 6, 5), indication="1")
    assert code == "ZLA-1"
    assert http.calls[-1].json["date_from"] == "2026-06-01"
    http.next = FakeResp(200, {})
    c.revoke_sick_leave(code="ZLA-1")


def test_zus_bledy(http):
    c = zus.HttpZusClient()
    http.next = FakeResp(400, {"detail": "zła data"})
    with pytest.raises(IntegrationError, match="zła data"):
        c.issue_sick_leave(pesel="1", doctor_pwz="9", date_from=date(2026, 6, 1),
                           date_to=date(2026, 6, 5), indication="1")
    http.next = httpx.ConnectError("down")
    with pytest.raises(IntegrationError):
        c.issue_sick_leave(pesel="1", doctor_pwz="9", date_from=date(2026, 6, 1),
                           date_to=date(2026, 6, 5), indication="1")
    http.next = FakeResp(400, text="nie można")
    with pytest.raises(IntegrationError, match="nie można"):
        c.revoke_sick_leave(code="ZLA-1")
    http.next = httpx.ConnectError("down")
    with pytest.raises(IntegrationError):
        c.revoke_sick_leave(code="ZLA-1")


# ---------------------------------------------------------------- SMS
def test_sms_http_best_effort(http):
    c = sms.HttpSmsClient(base_url="http://x")
    http.next = FakeResp(200)
    c.send(to="500100200", message="cześć")
    assert http.calls[-1].json["to"] == "500100200"
    http.next = httpx.HTTPError("down")
    c.send(to="500100200", message="x")  # best-effort — brak wyjątku


def test_sms_to_e164():
    assert sms._to_e164("+48500100200") == "+48500100200"
    assert sms._to_e164("0500100200") == "+48500100200"
    assert sms._to_e164("500100200") == "+48500100200"


def test_sms_twilio_i_redirect(http):
    t = sms.TwilioSmsClient("SID", "TOK", "+15550000000")
    http.next = FakeResp(201, {"sid": "SM1"})
    t.send(to="500100200", message="x")  # OK
    http.next = FakeResp(400, {"code": 21608, "message": "niezweryfikowany"})
    t.send(to="500100200", message="x")  # odrzucenie zalogowane, brak wyjątku
    http.next = FakeResp(400, text="raw")  # 400 bez JSON-a → fallback na text
    t.send(to="500100200", message="x")
    http.next = httpx.HTTPError("down")
    t.send(to="500100200", message="x")  # best-effort

    captured = []
    inner = SimpleNamespace(send=lambda **kw: captured.append(kw))
    sms.RedirectSmsClient(inner, "+48500000000").send(to="111", message="hej")
    assert captured[-1]["to"] == "+48500000000" and "111" in captured[-1]["message"]
    sms.NullSmsClient().send(to="x", message="y")  # no-op


def test_sms_get_client_selekcja(monkeypatch):
    monkeypatch.setattr(sms.settings, "sms_redirect_to", "")  # bez DEV-redirectu (czysty wybór)
    monkeypatch.setattr(sms.settings, "sms_enabled", False)
    sms.set_sms_client(None)
    assert isinstance(sms.get_sms_client(), sms.NullSmsClient)
    monkeypatch.setattr(sms.settings, "sms_enabled", True)
    monkeypatch.setattr(sms.settings, "sms_provider", "twilio")
    monkeypatch.setattr(sms.settings, "twilio_account_sid", "SID")
    monkeypatch.setattr(sms.settings, "twilio_auth_token", "TOK")
    monkeypatch.setattr(sms.settings, "twilio_from", "+1555")
    monkeypatch.setattr(sms.settings, "dev_mode", True)
    monkeypatch.setattr(sms.settings, "sms_redirect_to", "+48500000000")
    sms.set_sms_client(None)
    assert isinstance(sms.get_sms_client(), sms.RedirectSmsClient)
    sms.set_sms_client(None)


# ---------------------------------------------------------------- push (Expo)
def test_push_expo_send_filtruje_i_wysyla(http):
    c = push.ExpoPushClient()
    http.next = FakeResp(200, {"data": []})
    c.send(tokens=["ExponentPushToken[abc]", "śmieć"], title="T", body="B", data={"k": 1})
    sent = http.calls[-1].json
    assert isinstance(sent, list) and len(sent) == 1 and sent[0]["to"] == "ExponentPushToken[abc]"
    assert sent[0]["title"] == "T" and sent[0]["data"] == {"k": 1}


def test_push_expo_brak_waznych_tokenow_nie_wysyla(http):
    http.calls.clear()
    push.ExpoPushClient().send(tokens=["zły", ""], title="T", body="B")
    assert not http.calls  # żaden token nie zaczyna się od ExponentPushToken → brak POST


def test_push_expo_best_effort(http):
    http.next = FakeResp(400, text="bad token")
    push.ExpoPushClient().send(tokens=["ExponentPushToken[x]"], title="T", body="B")  # log, brak wyjątku
    http.next = httpx.HTTPError("down")
    push.ExpoPushClient().send(tokens=["ExponentPushToken[x]"], title="T", body="B")  # best-effort
    push.NullPushClient().send(tokens=["ExponentPushToken[x]"], title="T", body="B")  # no-op


# ---------------------------------------------------------------- e-mail
def test_email_mock_redirect_i_selekcja(monkeypatch):
    m = em.MockEmailClient()
    m.send(to="a@b.pl", subject="S", body="B")
    assert m.outbox[-1]["to"] == "a@b.pl"

    captured = []
    inner = SimpleNamespace(send=lambda **kw: captured.append(kw))
    em.RedirectEmailClient(inner, "test@x").send(to="real@y", subject="S", body="B")
    assert captured[-1]["to"] == "test@x" and "real@y" in captured[-1]["body"]

    monkeypatch.setattr(em.settings, "email_redirect_to", "")  # bez DEV-redirectu
    monkeypatch.setattr(em.settings, "email_provider", "mock")
    em.set_email_client(None)
    assert isinstance(em.get_email_client(), em.MockEmailClient)
    monkeypatch.setattr(em.settings, "email_provider", "smtp")
    monkeypatch.setattr(em.settings, "smtp_host", "smtp.x")
    monkeypatch.setattr(em.settings, "smtp_from", "NovaMed <f@x>")
    em.set_email_client(None)
    assert isinstance(em.get_email_client(), em.SmtpEmailClient)
    em.set_email_client(None)


def test_email_smtp_best_effort(monkeypatch):
    sent = {}

    class FakeSMTP:
        def __init__(self, host, port, timeout=None):
            sent["host"] = host

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def starttls(self):
            sent["tls"] = True

        def login(self, u, p):
            sent["login"] = (u, p)

        def send_message(self, msg):
            sent["to"] = msg["To"]

    monkeypatch.setattr(em.smtplib, "SMTP", FakeSMTP)
    em.SmtpEmailClient("smtp.x", 587, "u", "p", "NovaMed <f@x>").send(
        to="a@b.pl", subject="Potwierdzenie ąęś", body="treść")
    assert sent["tls"] and sent["login"] == ("u", "p") and sent["to"] == "a@b.pl"

    class BoomSMTP:
        def __init__(self, *a, **k):
            raise OSError("SMTP down")

    monkeypatch.setattr(em.smtplib, "SMTP", BoomSMTP)
    em.SmtpEmailClient("smtp.x", 587, "u", "p", "f@x").send(to="a@b.pl", subject="s", body="b")  # best-effort
