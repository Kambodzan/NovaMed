from datetime import datetime, timedelta

import pytest

from app.domain.reminders import send_due_reminders
from tests.conftest import auth_header


@pytest.fixture()
def setup(client, factory):
    _, reg_token = factory.user("rejestracja")
    doctor_user, doctor_token = factory.doctor()
    patient_user, patient_token = factory.patient()
    _, nurse_token = factory.user("pielegniarka")
    clinic = factory.clinic()
    factory.employ(clinic, doctor_user.user_id)
    return {
        "clinic": clinic, "doctor": doctor_user, "doctor_token": doctor_token,
        "patient": patient_user, "patient_token": patient_token,
        "reg_token": reg_token, "nurse_token": nurse_token,
    }


def make_visit_with_prescription(client, s) -> int:
    dt = (datetime.now() + timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0)
    slot = client.post(
        f"/clinics/{s['clinic'].clinic_id}/slots",
        json={"doctor_id": s["doctor"].user_id, "datetimes": [dt.isoformat()]},
        headers=auth_header(s["reg_token"]),
    ).json()[0]
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(s["patient_token"]))
    resp = client.post(
        f"/patients/{s['patient'].user_id}/prescriptions",
        json={"appointment_id": slot["appointment_id"], "icd10": "I10", "drugs": "Atorvasterol 40 mg ×30 — D.S. 1×1"},
        headers=auth_header(s["doctor_token"]),
    )
    return resp.json()["document_id"]


# ---------- UC-P6: udostępnianie kodem ----------

def test_udostepnianie_kodem_pelny_cykl(client, setup):
    s = setup
    make_visit_with_prescription(client, s)

    # pacjent generuje kod
    resp = client.post("/shares", json={"scope": "ALL", "hours_valid": 24}, headers=auth_header(s["patient_token"]))
    assert resp.status_code == 201, resp.text
    share = resp.json()
    assert len(share["access_code"]) == 7 and share["access_code"][3] == "-"

    # lekarz otwiera kodem
    resp = client.post("/shares/access", json={"code": share["access_code"]}, headers=auth_header(s["doctor_token"]))
    assert resp.status_code == 200
    shared = resp.json()
    assert shared["pesel"] == "90010112345"
    assert len(shared["documents"]) == 1

    # pielęgniarka też może; pacjent nie
    assert client.post("/shares/access", json={"code": share["access_code"]}, headers=auth_header(s["nurse_token"])).status_code == 200
    assert client.post("/shares/access", json={"code": share["access_code"]}, headers=auth_header(s["patient_token"])).status_code == 403

    # lista moich + unieważnienie (UC-P6 A1)
    mine = client.get("/shares/my", headers=auth_header(s["patient_token"])).json()
    assert len(mine) == 1
    client.delete(f"/shares/{share['share_id']}", headers=auth_header(s["patient_token"]))
    assert client.get("/shares/my", headers=auth_header(s["patient_token"])).json() == []
    resp = client.post("/shares/access", json={"code": share["access_code"]}, headers=auth_header(s["doctor_token"]))
    assert resp.status_code == 404


def test_udostepnianie_zakres_filtruje(client, setup):
    s = setup
    make_visit_with_prescription(client, s)
    # zakres LAB_RESULT — recepta nie powinna być widoczna
    share = client.post("/shares", json={"scope": "LAB_RESULT"}, headers=auth_header(s["patient_token"])).json()
    shared = client.post("/shares/access", json={"code": share["access_code"]}, headers=auth_header(s["doctor_token"])).json()
    assert shared["documents"] == []


def test_zly_kod_404(client, setup):
    resp = client.post("/shares/access", json={"code": "XXX-999"}, headers=auth_header(setup["doctor_token"]))
    assert resp.status_code == 404


# ---------- UC-P4: PDF ----------

def test_pdf_dokumentu(client, setup):
    s = setup
    doc_id = make_visit_with_prescription(client, s)

    resp = client.get(f"/documents/{doc_id}/pdf", headers=auth_header(s["patient_token"]))
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/pdf")
    assert resp.content[:5] == b"%PDF-"


def test_pdf_rbac(client, setup, factory):
    s = setup
    doc_id = make_visit_with_prescription(client, s)
    _, other_patient_token = factory.patient()
    assert client.get(f"/documents/{doc_id}/pdf", headers=auth_header(other_patient_token)).status_code == 403
    # personel może
    assert client.get(f"/documents/{doc_id}/pdf", headers=auth_header(s["doctor_token"])).status_code == 200


# ---------- UC-P7: przypomnienia ----------

def test_przypomnienia_24h(client, setup, db_session):
    s = setup
    # wizyta za ~20h (w oknie) i druga za 3 dni (poza oknem)
    near = (datetime.now() + timedelta(hours=20)).replace(minute=0, second=0, microsecond=0)
    far = (datetime.now() + timedelta(days=3)).replace(minute=0, second=0, microsecond=0)
    for dt in (near, far):
        slot = client.post(
            f"/clinics/{s['clinic'].clinic_id}/slots",
            json={"doctor_id": s["doctor"].user_id, "datetimes": [dt.isoformat()]},
            headers=auth_header(s["reg_token"]),
        ).json()[0]
        client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(s["patient_token"]))

    sent = send_due_reminders(db_session)
    assert sent == 1  # tylko wizyta w oknie 24h

    notifs = client.get("/notifications/my", headers=auth_header(s["patient_token"])).json()
    assert any(n["notification_title"] == "Przypomnienie o wizycie" for n in notifs)

    # idempotencja — drugi przebieg nic nie wysyła
    assert send_due_reminders(db_session) == 0
