from datetime import date, datetime, timedelta

import pytest

from app.integrations.base import IntegrationError
from app.integrations.p1 import get_p1_client
from app.integrations.zus import get_zus_client
from app.main import app
from tests.conftest import auth_header


class FakeP1:
    def __init__(self):
        self.fail = False
        self.counter = 0

    def _next(self) -> str:
        if self.fail:
            raise IntegrationError("P1 odrzuciło dokument: symulowany błąd.")
        self.counter += 1
        return f"{1000 + self.counter}"

    def issue_prescription(self, **kwargs) -> str:
        return self._next()

    def issue_referral(self, **kwargs) -> str:
        return self._next()


class FakeZus:
    def __init__(self):
        self.fail = False

    def issue_sick_leave(self, **kwargs) -> str:
        if self.fail:
            raise IntegrationError("ZUS odrzucił zwolnienie: symulowany błąd.")
        return "ZLA-2026-1001"


@pytest.fixture()
def fakes(client):
    p1, zus = FakeP1(), FakeZus()
    app.dependency_overrides[get_p1_client] = lambda: p1
    app.dependency_overrides[get_zus_client] = lambda: zus
    return p1, zus


@pytest.fixture()
def visit(client, factory):
    """Potwierdzona wizyta: klinika + lekarz + pacjent."""
    _, reg_token = factory.user("rejestracja")
    doctor_user, doctor_token = factory.doctor()
    patient_user, patient_token = factory.patient()
    clinic = factory.clinic()
    factory.employ(clinic, doctor_user.user_id)

    dt = (datetime.now() + timedelta(days=2)).replace(hour=10, minute=0, second=0, microsecond=0)
    resp = client.post(
        f"/clinics/{clinic.clinic_id}/slots",
        json={"doctor_id": str(doctor_user.user_id), "datetimes": [dt.isoformat()]},
        headers=auth_header(reg_token),
    )
    slot_id = resp.json()[0]["appointment_id"]
    client.post(f"/appointments/{slot_id}/book", headers=auth_header(patient_token))
    return {
        "appointment_id": slot_id,
        "doctor": doctor_user, "doctor_token": doctor_token,
        "patient": patient_user, "patient_token": patient_token,
    }


def test_erecepta_sukces_i_wglad_pacjenta(client, visit, fakes):
    body = {"appointment_id": visit["appointment_id"], "icd10": "I10", "drugs": "Atorvasterol 40 mg ×30 — D.S. 1×1"}
    resp = client.post(
        f"/patients/{visit['patient'].user_id}/prescriptions",
        json=body, headers=auth_header(visit["doctor_token"]),
    )
    assert resp.status_code == 201, resp.text
    doc = resp.json()
    assert doc["document_status"] == "CONFIRMED"
    assert doc["code"] is not None

    resp = client.get("/documents/my", headers=auth_header(visit["patient_token"]))
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["document_type"] == "PRESCRIPTION"


def test_erecepta_blad_p1_i_ponowna_wysylka(client, visit, fakes):
    p1, _ = fakes
    p1.fail = True
    body = {"appointment_id": visit["appointment_id"], "icd10": "I10", "drugs": "Metformax 850"}
    resp = client.post(
        f"/patients/{visit['patient'].user_id}/prescriptions",
        json=body, headers=auth_header(visit["doctor_token"]),
    )
    assert resp.status_code == 201
    doc = resp.json()
    assert doc["document_status"] == "ERROR"
    assert "symulowany" in doc["error_message"]

    # lekarz poprawia/ponawia — P1 wstaje
    p1.fail = False
    resp = client.post(f"/documents/{doc['document_id']}/resend", headers=auth_header(visit["doctor_token"]))
    assert resp.status_code == 200
    assert resp.json()["document_status"] == "CONFIRMED"
    assert resp.json()["code"] is not None

    # ponowny resend po sukcesie — 409
    resp = client.post(f"/documents/{doc['document_id']}/resend", headers=auth_header(visit["doctor_token"]))
    assert resp.status_code == 409


def test_skierowanie_nursing_wewnetrzne(client, visit, fakes, factory):
    body = {
        "appointment_id": visit["appointment_id"], "referral_type": "NURSING",
        "icd10": "I10", "notes": "Iniekcje domięśniowe 1×dz. przez 10 dni",
    }
    resp = client.post(
        f"/patients/{visit['patient'].user_id}/referrals",
        json=body, headers=auth_header(visit["doctor_token"]),
    )
    assert resp.status_code == 201
    doc = resp.json()
    assert doc["document_status"] == "ACTIVE"
    assert doc["code"].startswith("NUR-")

    # pielęgniarka widzi skierowanie w swojej kolejce
    _, nurse_token = factory.user("pielegniarka")
    resp = client.get("/referrals/nursing", headers=auth_header(nurse_token))
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    # pacjent nie ma dostępu do kolejki pielęgniarskiej
    assert client.get("/referrals/nursing", headers=auth_header(visit["patient_token"])).status_code == 403


def test_skierowanie_lab_przez_p1(client, visit, fakes):
    body = {"appointment_id": visit["appointment_id"], "referral_type": "LAB", "icd10": "E78.0"}
    resp = client.post(
        f"/patients/{visit['patient'].user_id}/referrals",
        json=body, headers=auth_header(visit["doctor_token"]),
    )
    assert resp.status_code == 201
    assert resp.json()["document_status"] == "CONFIRMED"
    assert not resp.json()["code"].startswith("NUR-")


def test_ezla(client, visit, fakes):
    start = date.today().isoformat()
    end = (date.today() + timedelta(days=6)).isoformat()
    body = {"appointment_id": visit["appointment_id"], "date_from": start, "date_to": end}
    resp = client.post(
        f"/patients/{visit['patient'].user_id}/sick-leaves",
        json=body, headers=auth_header(visit["doctor_token"]),
    )
    assert resp.status_code == 201
    doc = resp.json()
    assert doc["document_status"] == "SENT"
    assert doc["code"].startswith("ZLA-")


def test_wynik_badania_i_notatka(client, visit, fakes):
    resp = client.post(
        f"/patients/{visit['patient'].user_id}/lab-results",
        json={"appointment_id": visit["appointment_id"], "test_type": "USG jamy brzusznej", "test_description": "Bez odchyleń."},
        headers=auth_header(visit["doctor_token"]),
    )
    assert resp.status_code == 201
    assert resp.json()["document_status"] == "READY"

    resp = client.post(
        f"/patients/{visit['patient'].user_id}/notes",
        json={"appointment_id": visit["appointment_id"], "content": "RR 138/88, kontynuacja leczenia, kontrola za 6 tyg."},
        headers=auth_header(visit["doctor_token"]),
    )
    assert resp.status_code == 201
    assert resp.json()["document_status"] == "FINAL"

    resp = client.get(f"/patients/{visit['patient'].user_id}/documents", headers=auth_header(visit["doctor_token"]))
    assert len(resp.json()) == 2


def test_rbac_dokumentow(client, visit, fakes, factory):
    # pacjent nie wystawia recept
    body = {"appointment_id": visit["appointment_id"], "icd10": "I10", "drugs": "Atorvasterol 40 mg"}
    resp = client.post(
        f"/patients/{visit['patient'].user_id}/prescriptions",
        json=body, headers=auth_header(visit["patient_token"]),
    )
    assert resp.status_code == 403

    # inny lekarz nie wystawi dokumentu na cudzej wizycie
    _, other_doctor_token = factory.doctor()
    resp = client.post(
        f"/patients/{visit['patient'].user_id}/prescriptions",
        json=body, headers=auth_header(other_doctor_token),
    )
    assert resp.status_code == 403

    # pacjent nie widzi dokumentów innego pacjenta
    other_patient, other_patient_token = factory.patient()
    resp = client.get(f"/patients/{visit['patient'].user_id}/documents", headers=auth_header(other_patient_token))
    assert resp.status_code == 403
