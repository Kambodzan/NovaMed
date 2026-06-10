from datetime import datetime, timedelta

import pytest

from tests.conftest import auth_header


@pytest.fixture()
def setup(client, factory):
    _, reg_token = factory.user("rejestracja")
    doctor_user, doctor_token = factory.doctor()
    patient_user, patient_token = factory.patient()
    clinic = factory.clinic()
    factory.employ(clinic, doctor_user.user_id)
    return {
        "clinic": clinic, "doctor": doctor_user, "doctor_token": doctor_token,
        "patient": patient_user, "patient_token": patient_token, "reg_token": reg_token,
    }


def make_slot(client, s, price=None, days_ahead=3, hour=10):
    dt = (datetime.now() + timedelta(days=days_ahead)).replace(hour=hour, minute=0, second=0, microsecond=0)
    body = {"doctor_id": s["doctor"].user_id, "datetimes": [dt.isoformat()]}
    if price is not None:
        body["price"] = price
    resp = client.post(f"/clinics/{s['clinic'].clinic_id}/slots", json=body, headers=auth_header(s["reg_token"]))
    assert resp.status_code == 201, resp.text
    return resp.json()[0]


# ---------- płatności (UC-O1) ----------

def test_platna_wizyta_sukces(client, setup):
    slot = make_slot(client, setup, price=200)
    assert slot["price"] == 200

    resp = client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(setup["patient_token"]))
    assert resp.status_code == 200
    body = resp.json()
    assert body["appointment"]["appointment_status"] == "TEMP_LOCK"
    assert body["payment"]["payment_status"] == "PENDING"
    assert body["payment"]["amount"] == 200

    # zablokowany slot nie jest widoczny w wyszukiwarce
    assert client.get("/slots", headers=auth_header(setup["patient_token"])).json() == []

    resp = client.post(
        f"/appointments/{slot['appointment_id']}/pay",
        json={"outcome": "success"}, headers=auth_header(setup["patient_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["appointment"]["appointment_status"] == "CONFIRMED"
    assert resp.json()["payment"]["payment_status"] == "PAID"


def test_platna_wizyta_odmowa_zwalnia_slot(client, setup, factory):
    slot = make_slot(client, setup, price=150)
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(setup["patient_token"]))

    resp = client.post(
        f"/appointments/{slot['appointment_id']}/pay",
        json={"outcome": "failure"}, headers=auth_header(setup["patient_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["appointment"]["appointment_status"] == "FREE"
    assert resp.json()["appointment"]["patient_id"] is None
    assert resp.json()["payment"]["payment_status"] == "FAILED"

    # termin wrócił do puli — inny pacjent może go zarezerwować
    _, other_token = factory.patient()
    resp = client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(other_token))
    assert resp.status_code == 200
    assert resp.json()["appointment"]["appointment_status"] == "TEMP_LOCK"


def test_pay_zabezpieczenia(client, setup, factory):
    slot = make_slot(client, setup, price=100)
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(setup["patient_token"]))

    # nie-właściciel → 403
    _, other_token = factory.patient()
    resp = client.post(f"/appointments/{slot['appointment_id']}/pay", json={"outcome": "success"}, headers=auth_header(other_token))
    assert resp.status_code == 403

    # po opłaceniu — kolejny pay → 409
    client.post(f"/appointments/{slot['appointment_id']}/pay", json={"outcome": "success"}, headers=auth_header(setup["patient_token"]))
    resp = client.post(f"/appointments/{slot['appointment_id']}/pay", json={"outcome": "success"}, headers=auth_header(setup["patient_token"]))
    assert resp.status_code == 409


def test_porzucenie_blokady_przez_cancel(client, setup):
    slot = make_slot(client, setup, price=120)
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(setup["patient_token"]))
    resp = client.post(f"/appointments/{slot['appointment_id']}/cancel", headers=auth_header(setup["patient_token"]))
    assert resp.status_code == 200
    assert resp.json()["appointment_status"] == "FREE"
    assert resp.json()["patient_id"] is None


def test_przelozenie_na_platny_slot_409(client, setup):
    free_slot = make_slot(client, setup, days_ahead=4, hour=9)
    paid_slot = make_slot(client, setup, price=180, days_ahead=5, hour=12)
    client.post(f"/appointments/{free_slot['appointment_id']}/book", headers=auth_header(setup["patient_token"]))
    resp = client.post(
        f"/appointments/{free_slot['appointment_id']}/reschedule",
        json={"new_appointment_id": paid_slot["appointment_id"]},
        headers=auth_header(setup["patient_token"]),
    )
    assert resp.status_code == 409


# ---------- eWUŚ (UC-I4) ----------

def test_ewus_weryfikacja_przy_rezerwacji(client, setup, integration_fakes):
    integration_fakes.ewus.insured = False
    slot = make_slot(client, setup)
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(setup["patient_token"]))

    assert len(integration_fakes.ewus.calls) == 1
    info = client.get(f"/patients/{setup['patient'].user_id}", headers=auth_header(setup["reg_token"])).json()
    assert info["insurance_status"] is False


def test_ewus_awaria_nie_blokuje_rezerwacji(client, setup, integration_fakes):
    integration_fakes.ewus.fail = True
    slot = make_slot(client, setup)
    resp = client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(setup["patient_token"]))
    assert resp.status_code == 200
    assert resp.json()["appointment"]["appointment_status"] == "CONFIRMED"


def test_ewus_reczna_weryfikacja(client, setup, integration_fakes):
    integration_fakes.ewus.insured = True
    resp = client.post(f"/patients/{setup['patient'].user_id}/verify-insurance", headers=auth_header(setup["reg_token"]))
    assert resp.status_code == 200
    assert resp.json()["insurance_status"] is True

    # pacjent nie weryfikuje sam
    resp = client.post(f"/patients/{setup['patient'].user_id}/verify-insurance", headers=auth_header(setup["patient_token"]))
    assert resp.status_code == 403


# ---------- laboratorium (UC-I2) ----------

def test_lab_zlecenie_i_synchronizacja(client, setup, integration_fakes):
    slot = make_slot(client, setup, days_ahead=2)
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(setup["patient_token"]))

    resp = client.post(
        f"/patients/{setup['patient'].user_id}/referrals",
        json={"appointment_id": slot["appointment_id"], "referral_type": "LAB", "icd10": "E78.0", "notes": "lipidogram"},
        headers=auth_header(setup["doctor_token"]),
    )
    assert resp.status_code == 201
    code = resp.json()["code"]

    # zlecenie zarejestrowane w laboratorium
    assert len(integration_fakes.lab.orders) == 1
    assert integration_fakes.lab.orders[0]["referral_code"] == code

    # laboratorium ma gotowy wynik → synchronizacja
    integration_fakes.lab.results = [{
        "referral_code": code, "test_type": "lipidogram",
        "result": "Cholesterol całk. 228 mg/dl • LDL 142 mg/dl",
    }]
    resp = client.post("/integrations/lab/sync", headers=auth_header(setup["reg_token"]))
    assert resp.status_code == 200
    assert resp.json() == {"imported": 1, "skipped": 0}

    # wynik w dokumentacji pacjenta, skierowanie zrealizowane
    docs = client.get("/documents/my", headers=auth_header(setup["patient_token"])).json()
    types = {d["document_type"]: d for d in docs}
    assert types["LAB_RESULT"]["document_status"] == "READY"
    assert "Cholesterol" in types["LAB_RESULT"]["details"]
    assert types["REFERRAL"]["document_status"] == "REALIZED"

    # ponowna synchronizacja → dedup
    resp = client.post("/integrations/lab/sync", headers=auth_header(setup["reg_token"]))
    assert resp.json() == {"imported": 0, "skipped": 1}

    # pacjent nie uruchomi synchronizacji
    assert client.post("/integrations/lab/sync", headers=auth_header(setup["patient_token"])).status_code == 403
