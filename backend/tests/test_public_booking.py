# M8.6: publiczne umawianie bez konta + przejęcie konta gościa przy rejestracji.
from datetime import datetime, timedelta

import pytest

from tests.conftest import auth_header, make_token, verify_phone

GUEST = {
    "first_name": "Marek", "last_name": "Goscinny",
    "pesel": "85112234563", "birth_date": "1985-11-22",
    "phone_number": "603111222", "email": "marek.goscinny@example.com",
}


@pytest.fixture()
def setup(client, factory):
    _, reg_token = factory.user("rejestracja")
    doctor_user, _ = factory.doctor()
    clinic = factory.clinic()
    factory.employ(clinic, doctor_user.user_id)
    return {"clinic": clinic, "doctor": doctor_user, "reg_token": reg_token}


def make_slot(client, s, days_ahead=3, hour=10, **extra):
    dt = (datetime.now() + timedelta(days=days_ahead)).replace(hour=hour, minute=0, second=0, microsecond=0)
    body = {"datetimes": [dt.isoformat()], **extra}
    if "service_name" not in extra:
        body["doctor_id"] = str(s["doctor"].user_id)
    return client.post(f"/clinics/{s['clinic'].clinic_id}/slots", json=body,
                       headers=auth_header(s["reg_token"])).json()[0]


def test_publiczne_sloty_bez_logowania(client, setup):
    make_slot(client, setup)
    resp = client.get("/public/slots")
    assert resp.status_code == 200 and len(resp.json()) >= 1
    assert client.get("/public/clinics").status_code == 200


def test_rezerwacja_goscia_i_przejecie_konta(client, setup, db_session):
    slot = make_slot(client, setup, hour=11)
    verify_phone(client, GUEST["phone_number"], "BOOKING")
    r = client.post("/public/book", json={**GUEST, "appointment_id": slot["appointment_id"],
                                          "reason": "ból gardła"})
    assert r.status_code == 200, r.text
    assert r.json()["appointment"]["appointment_status"] == "CONFIRMED"
    assert r.json()["appointment"]["notes"] == "ból gardła"

    # gość nie może się zalogować (konto nieaktywne) — ale rejestracja tym samym
    # e-mailem PRZEJMUJE konto z historią wizyt
    token = make_token(email=GUEST["email"])
    verify_phone(client, GUEST["phone_number"], "REGISTRATION")
    reg = client.post("/auth/register-profile", headers=auth_header(token), json={
        "first_name": GUEST["first_name"], "last_name": GUEST["last_name"],
        "pesel": GUEST["pesel"], "birth_date": GUEST["birth_date"], "phone_number": GUEST["phone_number"],
    })
    assert reg.status_code == 201, reg.text
    mine = client.get("/appointments/my", headers=auth_header(token))
    assert mine.status_code == 200
    assert any(v["appointment_id"] == slot["appointment_id"] for v in mine.json())


def test_gosc_nfz_badanie_wymaga_skierowania(client, setup):
    exam = make_slot(client, setup, hour=8, service_name="RTG klatki piersiowej")
    deny = client.post("/public/book", json={**GUEST, "appointment_id": exam["appointment_id"]})
    assert deny.status_code == 409 and "skierowania" in deny.json()["detail"]
    verify_phone(client, GUEST["phone_number"], "BOOKING")
    ok = client.post("/public/book", json={**GUEST, "appointment_id": exam["appointment_id"],
                                           "external_referral": True})
    assert ok.status_code == 200
    assert ok.json()["appointment"]["appointment_status"] == "CONFIRMED"
    assert ok.json()["payment"] is None  # NFZ — bez płatności


def test_gosc_platny_slot_oplaca_online(client, setup):
    """Gość bez logowania rezerwuje wizytę prywatną i opłaca ją online (mock bramki)."""
    paid = make_slot(client, setup, hour=12, price=200)
    verify_phone(client, GUEST["phone_number"], "BOOKING")
    r = client.post("/public/book", json={**GUEST, "appointment_id": paid["appointment_id"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["appointment"]["appointment_status"] == "TEMP_LOCK"  # zablokowany do opłacenia
    assert body["payment"]["payment_status"] == "PENDING" and body["payment"]["amount"] == 200
    token = body["payment"]["pay_token"]
    assert token

    pay = client.post(f"/public/visit/{token}/pay", json={"outcome": "success"})
    assert pay.status_code == 200, pay.text
    assert pay.json()["appointment"]["appointment_status"] == "CONFIRMED"
    assert pay.json()["payment"]["payment_status"] == "PAID"


def test_gosc_platny_odmowa_zwalnia_termin(client, setup):
    paid = make_slot(client, setup, hour=13, price=150)
    verify_phone(client, GUEST["phone_number"], "BOOKING")
    token = client.post("/public/book", json={**GUEST, "appointment_id": paid["appointment_id"]}).json()["payment"]["pay_token"]
    pay = client.post(f"/public/visit/{token}/pay", json={"outcome": "failure"})
    assert pay.status_code == 200
    assert pay.json()["appointment"]["appointment_status"] == "FREE"   # termin wraca do puli
    assert pay.json()["payment"]["payment_status"] == "FAILED"


def test_hold_blokuje_termin_i_release_zwalnia(client, setup):
    slot = make_slot(client, setup, hour=15)
    sid = slot["appointment_id"]
    h = client.post(f"/public/slots/{sid}/hold")
    assert h.status_code == 200
    token = h.json()["hold_token"]
    # zablokowany — znika z publicznej puli
    assert all(s["appointment_id"] != sid for s in client.get("/public/slots").json())
    # druga osoba nie zaholduje już zajętego
    assert client.post(f"/public/slots/{sid}/hold").status_code == 409
    # release swoim tokenem → wraca do puli
    assert client.post(f"/public/slots/{sid}/release?hold_token={token}").json()["released"] is True
    assert any(s["appointment_id"] == sid for s in client.get("/public/slots").json())


def test_book_na_wlasnym_holdzie(client, setup):
    slot = make_slot(client, setup, hour=16)
    sid = slot["appointment_id"]
    token = client.post(f"/public/slots/{sid}/hold").json()["hold_token"]
    verify_phone(client, GUEST["phone_number"], "BOOKING")
    r = client.post("/public/book", json={**GUEST, "appointment_id": sid, "hold_token": token})
    assert r.status_code == 200, r.text
    assert r.json()["appointment"]["appointment_status"] == "CONFIRMED"


def test_book_na_cudzym_holdzie_409(client, setup):
    slot = make_slot(client, setup, hour=17)
    sid = slot["appointment_id"]
    client.post(f"/public/slots/{sid}/hold")  # trzyma ktoś inny (inny token)
    r = client.post("/public/book", json={**GUEST, "appointment_id": sid, "hold_token": "nie-moj-token"})
    assert r.status_code == 409


def test_porzucony_hold_wraca_do_puli(client, setup, db_session):
    from datetime import datetime, timedelta
    import uuid as _uuid
    from app.models import Appointment
    from app.domain.reminders import release_expired_temp_locks
    slot = make_slot(client, setup, hour=18)
    sid = slot["appointment_id"]
    client.post(f"/public/slots/{sid}/hold")
    a = db_session.get(Appointment, _uuid.UUID(sid))
    a.lock_expires_at = datetime.now() - timedelta(minutes=1)  # hold wygasł
    db_session.commit()
    assert release_expired_temp_locks(db_session) >= 1
    a2 = db_session.get(Appointment, _uuid.UUID(sid))
    assert a2.appointment_status == "FREE" and a2.lock_expires_at is None


def test_gosc_pesel_aktywnego_pacjenta(client, setup, factory, db_session):
    patient_user, _ = factory.patient()
    from app.models import Patient
    # aktywny pacjent z PESEL-em gościa (pesel z conftest nie ma sumy kontrolnej)
    db_session.get(Patient, patient_user.user_id).pesel = GUEST["pesel"]
    db_session.commit()
    slot = make_slot(client, setup, hour=14)
    deny = client.post("/public/book", json={**GUEST, "appointment_id": slot["appointment_id"]})
    assert deny.status_code == 409 and "zaloguj" in deny.json()["detail"]


def test_przejecie_po_pesel_gosc_z_recepcji(client, setup, db_session):
    """Gość założony telefonicznie przez rejestrację (bez e-maila) zakłada potem
    konto z INNYM e-mailem — wpięcie do istniejącej kartoteki po PESEL (UC-PP1)."""
    reg = auth_header(setup["reg_token"])
    slot = make_slot(client, setup, hour=12)

    # rejestracja: nowy dzwoniący BEZ e-maila → placeholder, nie zmatchuje się mailem
    r = client.post("/patients/register", headers=reg, json={
        "first_name": "Ewa", "last_name": "Telefoniczna", "pesel": "44051401359",
        "birth_date": "1944-05-14", "phone_number": "603999888",
    })
    assert r.status_code == 201 and r.json()["existing"] is False
    pid = r.json()["patient_id"]
    assert client.post(f"/appointments/{slot['appointment_id']}/book-for", headers=reg,
                       json={"patient_id": pid}).status_code == 200

    # pacjent zakłada konto z INNYM e-mailem, ten sam PESEL → przejęcie po PESEL
    token = make_token(email="ewa.prywatna@example.com")
    verify_phone(client, "603999888", "REGISTRATION")
    rp = client.post("/auth/register-profile", headers=auth_header(token), json={
        "first_name": "Ewa", "last_name": "Telefoniczna", "pesel": "44051401359",
        "birth_date": "1944-05-14", "phone_number": "603999888",
    })
    assert rp.status_code == 201, rp.text
    assert str(rp.json()["user_id"]) == str(pid)  # TEN SAM rekord, nie duplikat

    mine = client.get("/appointments/my", headers=auth_header(token)).json()
    assert any(v["appointment_id"] == slot["appointment_id"] for v in mine)


def test_pesel_zly_telefon_nie_przejmuje(client, setup, db_session):
    """Sam PESEL nie wystarczy do scalenia kartoteki gościa — bez zgodnego
    telefonu powstaje NOWE konto (ochrona przed account takeover po PESEL)."""
    reg = auth_header(setup["reg_token"])
    r = client.post("/patients/register", headers=reg, json={
        "first_name": "Jan", "last_name": "Cichy", "pesel": "44051401359",
        "birth_date": "1944-05-14", "phone_number": "603999888",
    })
    assert r.status_code == 201
    pid = r.json()["patient_id"]

    # napastnik zna PESEL, ale podaje inny telefon → nie wpina się do cudzej kartoteki
    # (musi przy tym potwierdzić SWÓJ numer — kontroluje 111000111, nie 603999888)
    token = make_token(email="napastnik@example.com")
    verify_phone(client, "111000111", "REGISTRATION")
    rp = client.post("/auth/register-profile", headers=auth_header(token), json={
        "first_name": "Jan", "last_name": "Cichy", "pesel": "44051401359",
        "birth_date": "1944-05-14", "phone_number": "111000111",
    })
    assert rp.status_code == 201
    assert str(rp.json()["user_id"]) != str(pid)  # nowe konto, NIE kartoteka gościa
