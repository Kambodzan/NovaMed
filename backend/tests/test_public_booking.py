# M8.6: publiczne umawianie bez konta + przejęcie konta gościa przy rejestracji.
from datetime import datetime, timedelta

import pytest

from tests.conftest import auth_header, make_token

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
        body["doctor_id"] = s["doctor"].user_id
    return client.post(f"/clinics/{s['clinic'].clinic_id}/slots", json=body,
                       headers=auth_header(s["reg_token"])).json()[0]


def test_publiczne_sloty_bez_logowania(client, setup):
    make_slot(client, setup)
    resp = client.get("/public/slots")
    assert resp.status_code == 200 and len(resp.json()) >= 1
    assert client.get("/public/clinics").status_code == 200


def test_rezerwacja_goscia_i_przejecie_konta(client, setup, db_session):
    slot = make_slot(client, setup, hour=11)
    r = client.post("/public/book", json={**GUEST, "appointment_id": slot["appointment_id"],
                                          "reason": "ból gardła"})
    assert r.status_code == 200, r.text
    assert r.json()["appointment_status"] == "CONFIRMED"
    assert r.json()["notes"] == "ból gardła"

    # gość nie może się zalogować (konto nieaktywne) — ale rejestracja tym samym
    # e-mailem PRZEJMUJE konto z historią wizyt
    token = make_token(email=GUEST["email"])
    reg = client.post("/auth/register-profile", headers=auth_header(token), json={
        "first_name": GUEST["first_name"], "last_name": GUEST["last_name"],
        "pesel": GUEST["pesel"], "birth_date": GUEST["birth_date"], "phone_number": GUEST["phone_number"],
    })
    assert reg.status_code == 201, reg.text
    mine = client.get("/appointments/my", headers=auth_header(token))
    assert mine.status_code == 200
    assert any(v["appointment_id"] == slot["appointment_id"] for v in mine.json())


def test_gosc_platny_slot_i_nfz_badanie(client, setup):
    paid = make_slot(client, setup, hour=12, price=200)
    deny = client.post("/public/book", json={**GUEST, "appointment_id": paid["appointment_id"]})
    assert deny.status_code == 409 and "zalogowaniu" in deny.json()["detail"]

    exam = make_slot(client, setup, hour=8, service_name="RTG klatki piersiowej")
    deny2 = client.post("/public/book", json={**GUEST, "appointment_id": exam["appointment_id"]})
    assert deny2.status_code == 409 and "skierowania" in deny2.json()["detail"]
    ok = client.post("/public/book", json={**GUEST, "appointment_id": exam["appointment_id"],
                                           "external_referral": True})
    assert ok.status_code == 200


def test_gosc_pesel_aktywnego_pacjenta(client, setup, factory, db_session):
    patient_user, _ = factory.patient()
    from app.models import Patient
    # aktywny pacjent z PESEL-em gościa (pesel z conftest nie ma sumy kontrolnej)
    db_session.get(Patient, patient_user.user_id).pesel = GUEST["pesel"]
    db_session.commit()
    slot = make_slot(client, setup, hour=14)
    deny = client.post("/public/book", json={**GUEST, "appointment_id": slot["appointment_id"]})
    assert deny.status_code == 409 and "zaloguj" in deny.json()["detail"]
