# Rejestr dokumentów wystawionych przez lekarza (GET /documents/issued).
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


def test_rejestr_wystawionych_dokumentow(client, setup, factory):
    s = setup
    dt = (datetime.now() + timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0)
    slot = client.post(
        f"/clinics/{s['clinic'].clinic_id}/slots",
        json={"doctor_id": str(s["doctor"].user_id), "datetimes": [dt.isoformat()]},
        headers=auth_header(s["reg_token"]),
    ).json()[0]
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(s["patient_token"]))
    client.post(
        f"/patients/{s['patient'].user_id}/prescriptions",
        json={"appointment_id": slot["appointment_id"], "icd10": "I10", "drugs": "Atorvasterol 40 mg — D.S. 1×1"},
        headers=auth_header(s["doctor_token"]),
    )

    resp = client.get("/documents/issued", headers=auth_header(s["doctor_token"]))
    assert resp.status_code == 200, resp.text
    docs = resp.json()
    assert len(docs) == 1
    assert docs[0]["document_type"] == "PRESCRIPTION"
    assert docs[0]["patient_name"].startswith("Jan")

    # inny lekarz ma pusty rejestr; pacjent nie ma dostępu
    _, other_doctor_token = factory.doctor()
    assert client.get("/documents/issued", headers=auth_header(other_doctor_token)).json() == []
    assert client.get("/documents/issued", headers=auth_header(s["patient_token"])).status_code == 403
