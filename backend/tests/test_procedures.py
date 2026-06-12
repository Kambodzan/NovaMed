from datetime import datetime, timedelta

import pytest

from app.integrations.p1 import get_p1_client
from app.main import app
from tests.conftest import auth_header
from tests.test_documents import FakeP1


@pytest.fixture()
def nursing_setup(client, factory):
    """Wizyta + skierowanie NURSING + pielęgniarka."""
    app.dependency_overrides[get_p1_client] = lambda: FakeP1()
    _, reg_token = factory.user("rejestracja")
    doctor_user, doctor_token = factory.doctor()
    patient_user, patient_token = factory.patient()
    _, nurse_token = factory.user("pielegniarka")
    clinic = factory.clinic()
    factory.employ(clinic, doctor_user.user_id)

    dt = (datetime.now() + timedelta(days=2)).replace(hour=10, minute=0, second=0, microsecond=0)
    slot = client.post(
        f"/clinics/{clinic.clinic_id}/slots",
        json={"doctor_id": str(doctor_user.user_id), "datetimes": [dt.isoformat()]},
        headers=auth_header(reg_token),
    ).json()[0]
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(patient_token))

    referral = client.post(
        f"/patients/{patient_user.user_id}/referrals",
        json={
            "appointment_id": slot["appointment_id"], "referral_type": "NURSING",
            "icd10": "I10", "notes": "Iniekcje domięśniowe 1×dz.",
        },
        headers=auth_header(doctor_token),
    ).json()

    return {
        "referral": referral, "nurse_token": nurse_token, "doctor_token": doctor_token,
        "patient_token": patient_token, "reg_token": reg_token, "clinic": clinic,
    }


def plan(client, s, days_ahead=1):
    dt = (datetime.now() + timedelta(days=days_ahead)).replace(hour=9, minute=30, second=0, microsecond=0)
    return client.post(
        "/procedures",
        json={"referral_document_id": s["referral"]["document_id"], "procedure_datetime": dt.isoformat()},
        headers=auth_header(s["nurse_token"]),
    )


def test_planowanie_zabiegu_i_znikanie_z_kolejki(client, nursing_setup):
    s = nursing_setup
    # skierowanie w kolejce
    queue = client.get("/referrals/nursing", headers=auth_header(s["nurse_token"])).json()
    assert len(queue) == 1

    resp = plan(client, s)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["procedure_status"] == "PLANNED"
    assert body["procedure_type"].startswith("Iniekcje")
    assert body["ordered_by"]

    # zaplanowane → kolejka pusta; podwójne planowanie → 409
    assert client.get("/referrals/nursing", headers=auth_header(s["nurse_token"])).json() == []
    assert plan(client, s).status_code == 409


def test_dzien_pielegniarki_i_wykonanie(client, nursing_setup):
    s = nursing_setup
    proc = plan(client, s).json()
    day = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")

    resp = client.get(f"/procedures/day?day={day}", headers=auth_header(s["nurse_token"]))
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    resp = client.post(
        f"/procedures/{proc['procedure_id']}/complete",
        json={"notes": "Zabieg wykonany bez powikłań, pacjentka w stanie dobrym."},
        headers=auth_header(s["nurse_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["procedure_status"] == "DONE"
    assert "bez powikłań" in resp.json()["notes"]

    # skierowanie zrealizowane — widoczne w dokumentacji pacjenta
    docs = client.get("/documents/my", headers=auth_header(s["patient_token"])).json()
    referral_doc = next(d for d in docs if d["document_type"] == "REFERRAL")
    assert referral_doc["document_status"] == "REALIZED"

    # ponowne wykonanie → 409
    resp = client.post(
        f"/procedures/{proc['procedure_id']}/complete",
        json={"notes": "ponowna próba"}, headers=auth_header(s["nurse_token"]),
    )
    assert resp.status_code == 409


def test_anulowanie_zwraca_skierowanie_do_kolejki(client, nursing_setup):
    s = nursing_setup
    proc = plan(client, s).json()
    resp = client.post(f"/procedures/{proc['procedure_id']}/cancel", headers=auth_header(s["nurse_token"]))
    assert resp.status_code == 200
    assert resp.json()["procedure_status"] == "CANCELLED"

    queue = client.get("/referrals/nursing", headers=auth_header(s["nurse_token"])).json()
    assert len(queue) == 1


def test_rbac_zabiegow(client, nursing_setup, factory):
    s = nursing_setup
    # lekarz nie planuje zabiegów
    dt = (datetime.now() + timedelta(days=1)).isoformat()
    resp = client.post(
        "/procedures",
        json={"referral_document_id": s["referral"]["document_id"], "procedure_datetime": dt},
        headers=auth_header(s["doctor_token"]),
    )
    assert resp.status_code == 403

    # inna pielęgniarka nie odnotuje cudzego zabiegu
    proc = plan(client, s).json()
    _, other_nurse = factory.user("pielegniarka")
    resp = client.post(
        f"/procedures/{proc['procedure_id']}/complete",
        json={"notes": "x y z"}, headers=auth_header(other_nurse),
    )
    assert resp.status_code == 403


def test_raport_poradni_i_csv(client, nursing_setup):
    s = nursing_setup
    clinic_id = s["clinic"].clinic_id
    month = (datetime.now() + timedelta(days=2)).strftime("%Y-%m")

    # zakończ wizytę, żeby raport miał dane
    day = (datetime.now() + timedelta(days=2)).strftime("%Y-%m-%d")
    visits = client.get(f"/appointments/day?day={day}", headers=auth_header(s["doctor_token"])).json()
    vid = next(v["appointment_id"] for v in visits if v["patient_id"])
    client.post(f"/appointments/{vid}/status", json={"new_status": "IN_PROGRESS"}, headers=auth_header(s["doctor_token"]))
    client.post(f"/appointments/{vid}/status", json={"new_status": "COMPLETED"}, headers=auth_header(s["doctor_token"]))

    resp = client.get(f"/clinics/{clinic_id}/reports?month={month}", headers=auth_header(s["reg_token"]))
    assert resp.status_code == 200
    report = resp.json()
    assert report["total_booked"] == 1
    assert report["completed"] == 1
    assert len(report["per_doctor"]) == 1
    assert report["per_doctor"][0]["completed"] == 1

    # pacjent nie ma dostępu do raportów
    assert client.get(f"/clinics/{clinic_id}/reports?month={month}", headers=auth_header(s["patient_token"])).status_code == 403

    resp = client.get(f"/clinics/{clinic_id}/reports/csv?month={month}", headers=auth_header(s["reg_token"]))
    assert resp.status_code == 200
    assert "Lekarz;Wizyty;Zako" in resp.text
