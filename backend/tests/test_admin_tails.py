from datetime import datetime, timedelta

import pytest

from tests.conftest import auth_header


@pytest.fixture()
def setup(client, factory):
    _, reg_token = factory.user("rejestracja")
    doctor_user, doctor_token = factory.doctor(specialization="Kardiolog")
    patient_user, patient_token = factory.patient()
    _, admin_token = factory.user("administrator")
    clinic = factory.clinic()
    factory.employ(clinic, doctor_user.user_id)
    return {
        "clinic": clinic, "doctor": doctor_user, "doctor_token": doctor_token,
        "patient": patient_user, "patient_token": patient_token,
        "reg_token": reg_token, "admin_token": admin_token,
    }


def completed_visit(client, s) -> int:
    dt = (datetime.now() + timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0)
    slot = client.post(
        f"/clinics/{s['clinic'].clinic_id}/slots",
        json={"doctor_id": str(s["doctor"].user_id), "datetimes": [dt.isoformat()]},
        headers=auth_header(s["reg_token"]),
    ).json()[0]
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(s["patient_token"]))
    for st in ["IN_PROGRESS", "COMPLETED"]:
        client.post(f"/appointments/{slot['appointment_id']}/status",
                    json={"new_status": st}, headers=auth_header(s["doctor_token"]))
    return slot["appointment_id"]


# ---------- opinie (UC-P8) ----------

def test_opinia_po_zakonczonej_wizycie(client, setup):
    aid = completed_visit(client, setup)
    resp = client.post("/reviews", json={
        "appointment_id": aid, "doctor_rating": 5, "doctor_comment": "Świetna opieka",
        "clinic_rating": 4,
    }, headers=auth_header(setup["patient_token"]))
    assert resp.status_code == 201, resp.text
    assert len(resp.json()) == 2  # lekarz + klinika

    # średnia lekarza
    resp = client.get(f"/reviews/doctor/{setup['doctor'].user_id}", headers=auth_header(setup["patient_token"]))
    assert resp.json()["average"] == 5.0
    assert resp.json()["count"] == 1

    # ponowne wystawienie = edycja opinii w oknie czasowym (UC-P8 A2), nie duplikat
    resp = client.post("/reviews", json={"appointment_id": aid, "doctor_rating": 1},
                       headers=auth_header(setup["patient_token"]))
    assert resp.status_code == 201
    resp = client.get(f"/reviews/doctor/{setup['doctor'].user_id}", headers=auth_header(setup["patient_token"]))
    assert resp.json()["count"] == 1 and resp.json()["average"] == 1.0  # zaktualizowana, nie zdublowana

    # flaga reviewed w moich wizytach
    mine = client.get("/appointments/my", headers=auth_header(setup["patient_token"])).json()
    assert mine[0]["reviewed"] is True


def test_opinia_nieodbytej_wizyty_409(client, setup):
    dt = (datetime.now() + timedelta(days=2)).replace(hour=11, minute=0, second=0, microsecond=0)
    slot = client.post(
        f"/clinics/{setup['clinic'].clinic_id}/slots",
        json={"doctor_id": str(setup["doctor"].user_id), "datetimes": [dt.isoformat()]},
        headers=auth_header(setup["reg_token"]),
    ).json()[0]
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(setup["patient_token"]))
    resp = client.post("/reviews", json={"appointment_id": slot["appointment_id"], "doctor_rating": 5},
                       headers=auth_header(setup["patient_token"]))
    assert resp.status_code == 409  # UC-P8 A1


# ---------- powiadomienia (UC-P7) ----------

def test_powiadomienia_rezerwacja_i_odczyt(client, setup):
    dt = (datetime.now() + timedelta(days=1)).replace(hour=12, minute=0, second=0, microsecond=0)
    slot = client.post(
        f"/clinics/{setup['clinic'].clinic_id}/slots",
        json={"doctor_id": str(setup["doctor"].user_id), "datetimes": [dt.isoformat()]},
        headers=auth_header(setup["reg_token"]),
    ).json()[0]
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(setup["patient_token"]))

    resp = client.get("/notifications/my", headers=auth_header(setup["patient_token"]))
    assert resp.status_code == 200
    notifs = resp.json()
    assert any("potwierdzona" in n["notification_title"].lower() for n in notifs)

    unread = client.get("/notifications/unread-count", headers=auth_header(setup["patient_token"])).json()["unread"]
    assert unread >= 1

    client.post("/notifications/read-all", headers=auth_header(setup["patient_token"]))
    assert client.get("/notifications/unread-count", headers=auth_header(setup["patient_token"])).json()["unread"] == 0


def test_powiadomienie_o_dokumencie(client, setup):
    aid = completed_visit(client, setup)
    client.post(
        f"/patients/{setup['patient'].user_id}/prescriptions",
        json={"appointment_id": aid, "icd10": "I10", "drugs": "Atorvasterol 40 mg"},
        headers=auth_header(setup["doctor_token"]),
    )
    notifs = client.get("/notifications/my", headers=auth_header(setup["patient_token"])).json()
    assert any("e-recepta" in n["notification_title"] for n in notifs)


# ---------- lista oczekujących (UC-P3 A1) ----------

def test_lista_oczekujacych_i_powiadomienie_o_slotach(client, setup):
    resp = client.post("/waiting-list", json={"specialization": "Kardiolog"},
                       headers=auth_header(setup["patient_token"]))
    assert resp.status_code == 201
    # duplikat → 409
    assert client.post("/waiting-list", json={"specialization": "Kardiolog"},
                       headers=auth_header(setup["patient_token"])).status_code == 409
    assert len(client.get("/waiting-list/my", headers=auth_header(setup["patient_token"])).json()) == 1

    # nowe sloty kardiologa → powiadomienie + wpis znika
    dt = (datetime.now() + timedelta(days=3)).replace(hour=9, minute=0, second=0, microsecond=0)
    client.post(
        f"/clinics/{setup['clinic'].clinic_id}/slots",
        json={"doctor_id": str(setup["doctor"].user_id), "datetimes": [dt.isoformat()]},
        headers=auth_header(setup["reg_token"]),
    )
    assert client.get("/waiting-list/my", headers=auth_header(setup["patient_token"])).json() == []
    notifs = client.get("/notifications/my", headers=auth_header(setup["patient_token"])).json()
    assert any("Nowe terminy" in n["notification_title"] for n in notifs)


# ---------- admin (UC-A1/A3) ----------

def test_admin_users_i_blokada(client, setup):
    resp = client.get("/admin/users", headers=auth_header(setup["admin_token"]))
    assert resp.status_code == 200
    users = resp.json()
    assert len(users) >= 4

    # pacjent nie ma dostępu
    assert client.get("/admin/users", headers=auth_header(setup["patient_token"])).status_code == 403

    # blokada konta pacjenta → jego token przestaje działać (403)
    resp = client.post(f"/admin/users/{setup['patient'].user_id}/toggle-active",
                       headers=auth_header(setup["admin_token"]))
    assert resp.status_code == 200
    assert resp.json()["active_account"] is False
    resp = client.get("/auth/me", headers=auth_header(setup["patient_token"]))
    assert resp.status_code == 403
    assert "zablokowane" in resp.json()["detail"].lower()

    # odblokowanie przywraca dostęp
    client.post(f"/admin/users/{setup['patient'].user_id}/toggle-active", headers=auth_header(setup["admin_token"]))
    assert client.get("/auth/me", headers=auth_header(setup["patient_token"])).status_code == 200


def test_admin_nie_blokuje_siebie_i_stats(client, setup, factory):
    admin_user = client.get("/auth/me", headers=auth_header(setup["admin_token"])).json()
    resp = client.post(f"/admin/users/{admin_user['user_id']}/toggle-active",
                       headers=auth_header(setup["admin_token"]))
    assert resp.status_code == 409

    resp = client.get("/admin/stats", headers=auth_header(setup["admin_token"]))
    assert resp.status_code == 200
    stats = resp.json()
    assert stats["database"] == "OK"
    assert stats["users_by_role"]["pacjent"] >= 1


def test_edycja_opinii_upsert(client, setup):
    s = setup
    # zakoncz wizyte, ktora ma lekarza i pacjenta
    from datetime import datetime, timedelta
    dt = (datetime.now() + timedelta(days=2)).replace(hour=9, minute=0, second=0, microsecond=0)
    slot = client.post(f"/clinics/{s['clinic'].clinic_id}/slots",
                       json={"doctor_id": str(s["doctor"].user_id), "datetimes": [dt.isoformat()]},
                       headers=auth_header(s["reg_token"])).json()[0]
    aid = slot["appointment_id"]
    client.post(f"/appointments/{aid}/book", headers=auth_header(s["patient_token"]))
    for st in ("IN_PROGRESS", "COMPLETED"):
        client.post(f"/appointments/{aid}/status", json={"new_status": st}, headers=auth_header(s["doctor_token"]))

    # pierwsza opinia
    r = client.post("/reviews", json={"appointment_id": aid, "doctor_rating": 3, "doctor_comment": "ok"},
                    headers=auth_header(s["patient_token"]))
    assert r.status_code == 201
    # ponowne wystawienie = edycja (nie 409)
    r = client.post("/reviews", json={"appointment_id": aid, "doctor_rating": 5, "doctor_comment": "super"},
                    headers=auth_header(s["patient_token"]))
    assert r.status_code == 201
    mine = client.get(f"/reviews/mine/{aid}", headers=auth_header(s["patient_token"])).json()
    assert mine["doctor_rating"] == 5 and mine["doctor_comment"] == "super" and mine["editable"] is True
    # srednia lekarza liczy 1 opinie (nie zdublowana)
    rev = client.get(f"/reviews/doctor/{s['doctor'].user_id}", headers=auth_header(s["patient_token"])).json()
    assert rev["count"] == 1 and rev["average"] == 5.0
