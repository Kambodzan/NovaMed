# Konta rodzinne — opiekun zakłada profil podopiecznego i działa
# w jego imieniu (?as_patient=); powiadomienia podopiecznego idą do opiekuna.
from datetime import datetime, timedelta

import pytest

from tests.conftest import auth_header

DEPENDENT = {
    "first_name": "Staś",
    "last_name": "Wiśniewski",
    "pesel": "20210112342",  # poprawna suma kontrolna
    "birth_date": "2021-01-01",
}


@pytest.fixture()
def setup(client, factory):
    _, reg_token = factory.user("rejestracja")
    doctor_user, doctor_token = factory.doctor()
    guardian_user, guardian_token = factory.patient()
    clinic = factory.clinic()
    factory.employ(clinic, doctor_user.user_id)
    return {
        "clinic": clinic, "doctor": doctor_user, "doctor_token": doctor_token,
        "guardian": guardian_user, "guardian_token": guardian_token, "reg_token": reg_token,
    }


def add_dependent(client, token) -> int:
    resp = client.post("/family", json=DEPENDENT, headers=auth_header(token))
    assert resp.status_code == 201
    return resp.json()["patient_id"]


def make_slot(client, s, days_ahead=3, hour=10):
    dt = (datetime.now() + timedelta(days=days_ahead)).replace(hour=hour, minute=0, second=0, microsecond=0)
    return client.post(
        f"/clinics/{s['clinic'].clinic_id}/slots",
        json={"doctor_id": str(s["doctor"].user_id), "datetimes": [dt.isoformat()]},
        headers=auth_header(s["reg_token"]),
    ).json()[0]


def test_dodanie_i_lista_podopiecznych(client, setup):
    dep_id = add_dependent(client, setup["guardian_token"])
    rows = client.get("/family", headers=auth_header(setup["guardian_token"])).json()
    assert [r["patient_id"] for r in rows] == [dep_id]
    assert rows[0]["first_name"] == "Staś"

    # duplikat PESEL → 409
    assert client.post("/family", json=DEPENDENT, headers=auth_header(setup["guardian_token"])).status_code == 409


def test_pesel_z_bledna_suma_kontrolna_odrzucony(client, setup):
    resp = client.post("/family", json={**DEPENDENT, "pesel": "20210112345"},
                       headers=auth_header(setup["guardian_token"]))
    assert resp.status_code == 422
    assert "suma kontrolna" in str(resp.json())


def test_odpinanie_podopiecznego(client, setup, factory):
    dep_id = add_dependent(client, setup["guardian_token"])
    _, stranger_token = factory.patient()

    # obcy nie odepnie cudzego podopiecznego
    assert client.delete(f"/family/{dep_id}", headers=auth_header(stranger_token)).status_code == 404
    assert client.delete(f"/family/{dep_id}", headers=auth_header(setup["guardian_token"])).status_code == 204
    assert client.get("/family", headers=auth_header(setup["guardian_token"])).json() == []
    # po odpięciu brak dostępu do danych byłego podopiecznego
    assert client.get(f"/appointments/my?as_patient={dep_id}",
                      headers=auth_header(setup["guardian_token"])).status_code == 403


def test_rezerwacja_w_imieniu_podopiecznego(client, setup):
    dep_id = add_dependent(client, setup["guardian_token"])
    slot = make_slot(client, setup)

    resp = client.post(
        f"/appointments/{slot['appointment_id']}/book?as_patient={dep_id}",
        headers=auth_header(setup["guardian_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["appointment"]["patient_id"] == dep_id

    # wizyta widoczna na liście podopiecznego, nie opiekuna
    mine = client.get("/appointments/my", headers=auth_header(setup["guardian_token"])).json()
    assert mine == []
    deps = client.get(f"/appointments/my?as_patient={dep_id}", headers=auth_header(setup["guardian_token"])).json()
    assert len(deps) == 1

    # powiadomienie o potwierdzeniu trafiło do OPIEKUNA, z imieniem podopiecznego
    notes = client.get("/notifications/my", headers=auth_header(setup["guardian_token"])).json()
    assert any("Staś" in n["notification_content"] for n in notes)


def test_opiekun_moze_odwolac_wizyte_podopiecznego(client, setup):
    dep_id = add_dependent(client, setup["guardian_token"])
    slot = make_slot(client, setup, days_ahead=5)
    client.post(f"/appointments/{slot['appointment_id']}/book?as_patient={dep_id}",
                headers=auth_header(setup["guardian_token"]))
    resp = client.post(f"/appointments/{slot['appointment_id']}/cancel",
                       headers=auth_header(setup["guardian_token"]))
    assert resp.status_code == 200
    assert resp.json()["appointment_status"] == "CANCELLED"


def test_obcy_pacjent_nie_jest_podopiecznym(client, setup, factory):
    dep_id = add_dependent(client, setup["guardian_token"])
    _, stranger_token = factory.patient()
    slot = make_slot(client, setup, days_ahead=4)

    # obcy nie zarezerwuje w imieniu cudzego podopiecznego
    resp = client.post(f"/appointments/{slot['appointment_id']}/book?as_patient={dep_id}",
                       headers=auth_header(stranger_token))
    assert resp.status_code == 403
    # ani nie podejrzy jego wizyt/dokumentów
    assert client.get(f"/appointments/my?as_patient={dep_id}", headers=auth_header(stranger_token)).status_code == 403
    assert client.get(f"/documents/my?as_patient={dep_id}", headers=auth_header(stranger_token)).status_code == 403


def test_dokumentacja_podopiecznego_dla_opiekuna(client, setup):
    dep_id = add_dependent(client, setup["guardian_token"])
    slot = make_slot(client, setup, days_ahead=2)
    client.post(f"/appointments/{slot['appointment_id']}/book?as_patient={dep_id}",
                headers=auth_header(setup["guardian_token"]))

    # lekarz wystawia dokument podopiecznemu w kontekście wizyty
    client.post(f"/appointments/{slot['appointment_id']}/status", json={"new_status": "IN_PROGRESS"},
                headers=auth_header(setup["doctor_token"]))
    doc = client.post(
        f"/patients/{dep_id}/lab-results",
        json={"appointment_id": slot["appointment_id"], "test_type": "Morfologia", "test_description": "Bez odchyleń."},
        headers=auth_header(setup["doctor_token"]),
    )
    assert doc.status_code == 201
    doc_id = doc.json()["document_id"]

    docs = client.get(f"/documents/my?as_patient={dep_id}", headers=auth_header(setup["guardian_token"])).json()
    assert [d["document_id"] for d in docs] == [doc_id]
    # PDF dokumentu podopiecznego dostępny dla opiekuna
    pdf = client.get(f"/documents/{doc_id}/pdf", headers=auth_header(setup["guardian_token"]))
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"


def test_pelnoletni_podopieczny_wygasa_dostep(client, setup):
    """Po 18. urodzinach opiekun traci dostęp do działania w imieniu podopiecznego."""
    gt = setup["guardian_token"]
    adult = client.post("/family", json={
        "first_name": "Dorosły", "last_name": "Podopieczny",
        "pesel": "44051401359", "birth_date": "1944-05-14",  # pełnoletni
    }, headers=auth_header(gt))
    assert adult.status_code == 201
    aid = adult.json()["patient_id"]
    assert adult.json()["is_adult"] is True

    # lista pokazuje go z flagą pełnoletności
    deps = client.get("/family", headers=auth_header(gt)).json()
    assert any(d["patient_id"] == aid and d["is_adult"] for d in deps)

    # opiekun nie może działać w jego imieniu (as_patient → 403)
    r = client.get(f"/appointments/my?as_patient={aid}", headers=auth_header(gt))
    assert r.status_code == 403 and "pełnoletni" in r.json()["detail"].lower()
