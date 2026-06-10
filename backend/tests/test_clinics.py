from tests.conftest import auth_header


def test_tworzenie_kliniki_tylko_admin(client, factory):
    _, admin_token = factory.user("administrator")
    _, patient_token = factory.patient()

    body = {"clinic_name": "Zdrowa Rodzina", "address": "ul. Słowackiego 12, Piastów"}
    assert client.post("/clinics", json=body, headers=auth_header(patient_token)).status_code == 403

    resp = client.post("/clinics", json=body, headers=auth_header(admin_token))
    assert resp.status_code == 201
    assert resp.json()["clinic_id"] > 0

    resp = client.get("/clinics", headers=auth_header(patient_token))
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_personel_i_lekarze_placowki(client, factory):
    _, reg_token = factory.user("rejestracja")
    doctor_user, _ = factory.doctor(specialization="Endokrynolog")
    clinic = factory.clinic()

    resp = client.post(
        f"/clinics/{clinic.clinic_id}/staff",
        json={"user_id": doctor_user.user_id},
        headers=auth_header(reg_token),
    )
    assert resp.status_code == 201
    # podwójne przypisanie
    resp = client.post(
        f"/clinics/{clinic.clinic_id}/staff",
        json={"user_id": doctor_user.user_id},
        headers=auth_header(reg_token),
    )
    assert resp.status_code == 409

    resp = client.get(f"/clinics/{clinic.clinic_id}/doctors", headers=auth_header(reg_token))
    assert resp.status_code == 200
    doctors = resp.json()
    assert len(doctors) == 1
    assert doctors[0]["specialization"] == "Endokrynolog"


def test_pacjenci_placowki_rbac(client, factory):
    _, reg_token = factory.user("rejestracja")
    patient_user, patient_token = factory.patient()
    clinic = factory.clinic()

    resp = client.post(
        f"/clinics/{clinic.clinic_id}/patients",
        json={"patient_id": patient_user.user_id},
        headers=auth_header(reg_token),
    )
    assert resp.status_code == 201

    # pacjent nie widzi listy pacjentów placówki
    assert client.get(f"/clinics/{clinic.clinic_id}/patients", headers=auth_header(patient_token)).status_code == 403

    resp = client.get(f"/clinics/{clinic.clinic_id}/patients", headers=auth_header(reg_token))
    assert resp.status_code == 200
    assert resp.json()[0]["pesel"] == "90010112345"
