# Katalog usług (typy wizyt) + współrezerwacja czasu lekarza
from datetime import datetime, timedelta

from tests.conftest import auth_header


def test_uslugi_katalog_i_wspolrezerwacja(client, factory):
    kier_user, kier = factory.user("kierownik")
    _, reg = factory.user("rejestracja")
    doctor_user, _ = factory.doctor()
    patient_user, patient = factory.patient()
    clinic = factory.clinic()
    factory.employ(clinic, kier_user.user_id)
    factory.employ(clinic, doctor_user.user_id)
    cid, did = str(clinic.clinic_id), str(doctor_user.user_id)

    # kierownik tworzy 2 usługi; rejestracja nie może (governance #32a)
    assert client.post(f"/clinics/{cid}/services", headers=auth_header(reg),
                       json={"name": "x"}).status_code == 403
    s1 = client.post(f"/clinics/{cid}/services", headers=auth_header(kier),
                     json={"name": "Konsultacja internistyczna", "duration_min": 30}).json()
    s2 = client.post(f"/clinics/{cid}/services", headers=auth_header(kier),
                     json={"name": "USG jamy brzusznej", "duration_min": 30, "price": 150}).json()
    # przypięcie obu usług lekarzowi
    for s in (s1, s2):
        r = client.put(f"/clinics/{cid}/services/{s['service_id']}/doctors",
                       headers=auth_header(kier), json={"doctor_ids": [did]})
        assert r.status_code == 200 and did in [str(x) for x in r.json()["doctor_ids"]]
    # katalog widoczny
    assert {x["name"] for x in client.get(f"/clinics/{cid}/services", headers=auth_header(kier)).json()} \
        == {"Konsultacja internistyczna", "USG jamy brzusznej"}

    # nakładające się sloty: ta sama godzina, dwie różne usługi tego samego lekarza
    dt = (datetime.now() + timedelta(days=2)).replace(hour=10, minute=0, second=0, microsecond=0)
    def mk(sid):
        return client.post(f"/clinics/{cid}/slots", headers=auth_header(kier),
                           json={"doctor_id": did, "service_id": sid, "datetimes": [dt.isoformat()]})
    a1, a2 = mk(s1["service_id"]), mk(s2["service_id"])
    assert a1.status_code == 201 and a2.status_code == 201   # różne usługi o tej samej godzinie — dozwolone
    slot1, slot2 = a1.json()[0]["appointment_id"], a2.json()[0]["appointment_id"]
    # ten sam termin tej samej usługi → konflikt
    assert mk(s1["service_id"]).status_code == 409

    free = lambda: {x["appointment_id"] for x in client.get("/slots", headers=auth_header(patient)).json()}
    assert {slot1, slot2} <= free()

    # rezerwacja slot1 → slot2 (nakładający się) znika z puli (BLOCKED)
    assert client.post(f"/appointments/{slot1}/book", headers=auth_header(patient)).status_code == 200
    assert slot1 not in free() and slot2 not in free()

    # odwołanie slot1 → slot2 wraca do puli (współrezerwacja przywrócona)
    assert client.post(f"/appointments/{slot1}/cancel", headers=auth_header(patient)).status_code == 200
    assert slot2 in free()


def test_slot_uslugi_tylko_dla_wykonujacego_lekarza(client, factory):
    kier_user, kier = factory.user("kierownik")
    doctor_user, _ = factory.doctor()       # NIE przypięty do usługi
    clinic = factory.clinic()
    factory.employ(clinic, kier_user.user_id)
    factory.employ(clinic, doctor_user.user_id)
    cid, did = str(clinic.clinic_id), str(doctor_user.user_id)
    svc = client.post(f"/clinics/{cid}/services", headers=auth_header(kier),
                      json={"name": "USG", "duration_min": 20}).json()
    dt = (datetime.now() + timedelta(days=2)).replace(hour=9, minute=0, second=0, microsecond=0)
    r = client.post(f"/clinics/{cid}/slots", headers=auth_header(kier),
                    json={"doctor_id": did, "service_id": svc["service_id"], "datetimes": [dt.isoformat()]})
    assert r.status_code == 409 and "nie wykonuje" in r.json()["detail"]
