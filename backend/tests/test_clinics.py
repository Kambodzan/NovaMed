from tests.conftest import auth_header


def test_tworzenie_kliniki_tylko_admin(client, factory):
    _, admin_token = factory.user("administrator")
    _, patient_token = factory.patient()

    body = {"clinic_name": "Zdrowa Rodzina", "address": "ul. Słowackiego 12, Piastów"}
    assert client.post("/clinics", json=body, headers=auth_header(patient_token)).status_code == 403

    resp = client.post("/clinics", json=body, headers=auth_header(admin_token))
    assert resp.status_code == 201
    assert resp.json()["clinic_id"]

    resp = client.get("/clinics", headers=auth_header(patient_token))
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_personel_i_lekarze_placowki(client, factory):
    kier_user, kier_token = factory.user("kierownik")
    _, reg_token = factory.user("rejestracja")
    doctor_user, _ = factory.doctor(specialization="Endokrynolog")
    clinic = factory.clinic()
    factory.employ(clinic, kier_user.user_id)  # kierownik zarządza SWOJĄ placówką

    # rejestracja NIE zarządza kadrami (decyzja kierownicza)
    assert client.post(
        f"/clinics/{clinic.clinic_id}/staff",
        json={"user_id": str(doctor_user.user_id)},
        headers=auth_header(reg_token),
    ).status_code == 403

    resp = client.post(
        f"/clinics/{clinic.clinic_id}/staff",
        json={"user_id": str(doctor_user.user_id)},
        headers=auth_header(kier_token),
    )
    assert resp.status_code == 201
    # podwójne przypisanie
    resp = client.post(
        f"/clinics/{clinic.clinic_id}/staff",
        json={"user_id": str(doctor_user.user_id)},
        headers=auth_header(kier_token),
    )
    assert resp.status_code == 409

    resp = client.get(f"/clinics/{clinic.clinic_id}/doctors", headers=auth_header(reg_token))
    assert resp.status_code == 200
    doctors = resp.json()
    assert len(doctors) == 1
    assert "Endokrynolog" in doctors[0]["specializations"]


def test_slot_zawsze_na_siatce_placowki(client, factory):
    """Po cofnięciu #36: slot startuje na SIATCE PLACÓWKI (atom = clinic.slot_interval_min),
    bez względu na lekarza. Długość wizyty nie jest już per lekarz."""
    from datetime import datetime, timedelta
    kier_user, kier = factory.user("kierownik")
    doctor_user, _ = factory.doctor()
    clinic = factory.clinic()  # siatka placówki domyślnie 15 min
    factory.employ(clinic, kier_user.user_id)
    factory.employ(clinic, doctor_user.user_id)
    cid, did = clinic.clinic_id, doctor_user.user_id

    base = (datetime.now() + timedelta(days=2)).replace(hour=9, second=0, microsecond=0)
    def mk(minute):
        dt = base.replace(minute=minute)
        return client.post(f"/clinics/{cid}/slots",
                           json={"doctor_id": str(did), "datetimes": [dt.isoformat()]},
                           headers=auth_header(kier)).status_code
    assert mk(15) == 201   # na siatce 15
    assert mk(45) == 201
    assert mk(20) == 422   # 20 % 15 != 0 — poza siatką placówki


def test_pacjenci_placowki_rbac(client, factory):
    reg_user, reg_token = factory.user("rejestracja")
    patient_user, patient_token = factory.patient()
    clinic = factory.clinic()
    factory.employ(clinic, reg_user.user_id)

    resp = client.post(
        f"/clinics/{clinic.clinic_id}/patients",
        json={"patient_id": str(patient_user.user_id)},
        headers=auth_header(reg_token),
    )
    assert resp.status_code == 201

    # pacjent nie widzi listy pacjentów placówki
    assert client.get(f"/clinics/{clinic.clinic_id}/patients", headers=auth_header(patient_token)).status_code == 403

    resp = client.get(f"/clinics/{clinic.clinic_id}/patients", headers=auth_header(reg_token))
    assert resp.status_code == 200
    assert resp.json()[0]["pesel"] == "90010112345"
