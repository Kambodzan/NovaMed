# Weryfikacja telefonu kodem SMS (OTP) dla ścieżek bez logowania
from datetime import datetime, timedelta

import pytest

from app.models import PhoneVerification
from tests.conftest import auth_header, verify_phone

GUEST = {
    "first_name": "Olek", "last_name": "Zewnetrzny",
    "pesel": "85112234563", "birth_date": "1985-11-22",
    "phone_number": "601999000", "email": "olek.zew@example.com",
}


@pytest.fixture()
def slots(client, factory):
    """Dwa wolne terminy u jednego lekarza — do testów jednorazowości potwierdzenia."""
    _, reg_token = factory.user("rejestracja")
    doctor_user, _ = factory.doctor()
    clinic = factory.clinic()
    factory.employ(clinic, doctor_user.user_id)
    base = (datetime.now() + timedelta(days=3)).replace(hour=9, minute=0, second=0, microsecond=0)
    return client.post(f"/clinics/{clinic.clinic_id}/slots",
                       json={"doctor_id": str(doctor_user.user_id),
                             "datetimes": [base.isoformat(), (base + timedelta(hours=1)).isoformat()]},
                       headers=auth_header(reg_token)).json()


@pytest.fixture()
def slot(slots):
    return slots[0]


def test_send_zwraca_dev_code_i_verify_dziala(client):
    r = client.post("/public/otp/send", json={"phone_number": "601999000", "purpose": "BOOKING"})
    assert r.status_code == 200 and r.json()["sent"] is True
    code = r.json()["dev_code"]
    assert code and len(code) == 6
    ok = client.post("/public/otp/verify", json={"phone_number": "601999000", "code": code, "purpose": "BOOKING"})
    assert ok.status_code == 200 and ok.json()["verified"] is True


def test_rezerwacja_bez_potwierdzenia_400(client, slot):
    r = client.post("/public/book", json={**GUEST, "appointment_id": slot["appointment_id"]})
    assert r.status_code == 400 and "potwierd" in r.json()["detail"].lower()


def test_rezerwacja_po_potwierdzeniu_200(client, slot):
    verify_phone(client, GUEST["phone_number"], "BOOKING")
    r = client.post("/public/book", json={**GUEST, "appointment_id": slot["appointment_id"]})
    assert r.status_code == 200 and r.json()["appointment_status"] == "CONFIRMED"


def test_potwierdzenie_jest_jednorazowe(client, slots):
    """Spożyty dowód nie zadziała drugi raz — kolejna rezerwacja wymaga nowego potwierdzenia."""
    verify_phone(client, GUEST["phone_number"], "BOOKING")
    assert client.post("/public/book", json={**GUEST, "appointment_id": slots[0]["appointment_id"]}).status_code == 200
    # drugi termin BEZ ponownego potwierdzenia → 400 (dowód już spożyty)
    again = client.post("/public/book", json={**GUEST, "appointment_id": slots[1]["appointment_id"]})
    assert again.status_code == 400 and "potwierd" in again.json()["detail"].lower()
    # po ponownym potwierdzeniu przechodzi
    verify_phone(client, GUEST["phone_number"], "BOOKING")
    assert client.post("/public/book", json={**GUEST, "appointment_id": slots[1]["appointment_id"]}).status_code == 200


def test_zly_kod_400(client):
    client.post("/public/otp/send", json={"phone_number": "601999000", "purpose": "BOOKING"})
    r = client.post("/public/otp/verify", json={"phone_number": "601999000", "code": "000000", "purpose": "BOOKING"})
    assert r.status_code == 400 and "Nieprawid" in r.json()["detail"]


def test_kod_wygasl_400(client, db_session):
    code = client.post("/public/otp/send", json={"phone_number": "601999000", "purpose": "BOOKING"}).json()["dev_code"]
    row = db_session.query(PhoneVerification).filter(PhoneVerification.phone == "+48601999000").first()
    row.expires_at = datetime.now() - timedelta(minutes=1)
    db_session.commit()
    r = client.post("/public/otp/verify", json={"phone_number": "601999000", "code": code, "purpose": "BOOKING"})
    assert r.status_code == 400 and "wyga" in r.json()["detail"].lower()


def test_limit_wysylek_429(client):
    for _ in range(4):
        assert client.post("/public/otp/send", json={"phone_number": "601999000", "purpose": "BOOKING"}).status_code == 200
    blocked = client.post("/public/otp/send", json={"phone_number": "601999000", "purpose": "BOOKING"})
    assert blocked.status_code == 429
