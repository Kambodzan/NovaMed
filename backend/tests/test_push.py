# Powiadomienia push (Expo) — rejestracja tokenu urządzenia + dostawa kanałem push
# przez wspólny lej notify(). Fake-klient push (conftest) łapie wysyłki bez HTTP.
from app.domain.notify import notify

from tests.conftest import auth_header


def test_push_token_register_then_notify(client, factory, integration_fakes, db_session):
    """Zarejestrowany token dostaje push, gdy do użytkownika idzie powiadomienie."""
    user, token = factory.user("pacjent")
    r = client.post("/notifications/push-token",
                    json={"token": "ExponentPushToken[abc]"}, headers=auth_header(token))
    assert r.status_code == 204, r.text

    notify(db_session, user.user_id, "Wizyta potwierdzona", "Jutro 9:00")
    db_session.commit()

    assert integration_fakes.push.sent, "push powinien pójść na zarejestrowany token"
    last = integration_fakes.push.sent[-1]
    assert last["tokens"] == ["ExponentPushToken[abc]"]
    assert last["title"] == "Wizyta potwierdzona"


def test_push_pominiety_gdy_brak_tokenu(client, factory, integration_fakes, db_session):
    """Bez zarejestrowanego urządzenia kanał push jest cichym no-op (np. tylko web)."""
    user, _ = factory.user("pacjent")
    notify(db_session, user.user_id, "X", "Y")
    db_session.commit()
    assert not integration_fakes.push.sent


def test_push_token_przepiecie_wlasciciela(client, factory, integration_fakes, db_session):
    """Ten sam token zarejestrowany na drugim koncie = przepięcie właściciela
    (nowy login na tym samym telefonie); stary właściciel przestaje dostawać push."""
    a, ta = factory.user("pacjent")
    b, tb = factory.user("pacjent")
    client.post("/notifications/push-token",
                json={"token": "ExponentPushToken[shared]"}, headers=auth_header(ta))
    client.post("/notifications/push-token",
                json={"token": "ExponentPushToken[shared]"}, headers=auth_header(tb))

    notify(db_session, a.user_id, "X", "Y")
    db_session.commit()
    assert not integration_fakes.push.sent, "stary właściciel nie powinien dostać push"

    notify(db_session, b.user_id, "X", "Y")
    db_session.commit()
    assert integration_fakes.push.sent[-1]["tokens"] == ["ExponentPushToken[shared]"]


def test_push_token_wyrejestrowanie(client, factory, integration_fakes, db_session):
    """DELETE tokenu (wylogowanie) — kolejne powiadomienia nie idą już na to urządzenie."""
    user, token = factory.user("pacjent")
    client.post("/notifications/push-token",
                json={"token": "ExponentPushToken[a]"}, headers=auth_header(token))
    r = client.request("DELETE", "/notifications/push-token",
                       json={"token": "ExponentPushToken[a]"}, headers=auth_header(token))
    assert r.status_code == 204, r.text

    notify(db_session, user.user_id, "X", "Y")
    db_session.commit()
    assert not integration_fakes.push.sent
