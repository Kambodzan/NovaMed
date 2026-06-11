# Agregacja powiadomień o wcześniejszych
# terminach, timeout porzuconej płatności (TEMP_LOCK), telemed dla opiekuna.
from datetime import datetime, timedelta

import pytest

from app.domain.reminders import release_expired_temp_locks
from app.models import Payment
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


def make_slots(client, s, dts, price=None):
    return client.post(
        f"/clinics/{s['clinic'].clinic_id}/slots",
        json={"doctor_id": s["doctor"].user_id, "datetimes": dts, "price": price},
        headers=auth_header(s["reg_token"]),
    ).json()


def earlier_notices(client, token):
    notes = client.get("/notifications/my", headers=auth_header(token)).json()
    return [n for n in notes if "wcześniejszy termin" in n["notification_title"]]


def test_seria_slotow_to_jedno_powiadomienie(client, setup):
    # obserwator z wizytą za 60 dni (cała seria ×6 będzie wcześniejsza)
    far = (datetime.now() + timedelta(days=60)).replace(hour=10, minute=0, second=0, microsecond=0)
    slot = make_slots(client, setup, [far.isoformat()])[0]
    client.post(f"/appointments/{slot['appointment_id']}/book", json={"notify_earlier": True},
                headers=auth_header(setup["patient_token"]))

    # seria cykliczna ×6 wcześniejszych terminów = JEDNO powiadomienie, nie 6
    base = (datetime.now() + timedelta(days=7)).replace(hour=9, minute=0, second=0, microsecond=0)
    make_slots(client, setup, [(base + timedelta(weeks=i)).isoformat() for i in range(6)])

    notes = earlier_notices(client, setup["patient_token"])
    assert len(notes) == 1
    assert "i 5 kolejnych" in notes[0]["notification_content"]


def test_porzucony_temp_lock_wraca_do_puli(client, setup, db_session):
    dt = (datetime.now() + timedelta(days=5)).replace(hour=11, minute=0, second=0, microsecond=0)
    slot = make_slots(client, setup, [dt.isoformat()], price=200)[0]
    resp = client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(setup["patient_token"]))
    assert resp.json()["appointment"]["appointment_status"] == "TEMP_LOCK"

    # świeży TEMP_LOCK nie jest ruszany
    assert release_expired_temp_locks(db_session) == 0

    # postarz płatność o 30 min → sprzątanie zwalnia slot
    from sqlalchemy import select
    payment = db_session.scalar(select(Payment).where(Payment.appointment_id == slot["appointment_id"]))
    assert payment is not None
    payment.created_at = datetime.now() - timedelta(minutes=30)
    db_session.commit()
    assert release_expired_temp_locks(db_session) == 1

    detail = client.get(f"/appointments/{slot['appointment_id']}", headers=auth_header(setup["doctor_token"])).json()
    assert detail["appointment_status"] == "FREE"
    assert detail["patient_id"] is None

    notes = client.get("/notifications/my", headers=auth_header(setup["patient_token"])).json()
    assert any("Rezerwacja wygasła" in n["notification_title"] for n in notes)


def test_opiekun_ma_dostep_do_zalacznikow_telewizyty_podopiecznego(client, setup, factory):
    # podopieczny + teleporada zarezerwowana przez opiekuna
    dep = client.post("/family", json={
        "first_name": "Staś", "last_name": "Testowy",
        "pesel": "21210112349", "birth_date": "2021-01-01",
    }, headers=auth_header(setup["patient_token"])).json()
    dt = (datetime.now() + timedelta(days=2)).replace(hour=9, minute=0, second=0, microsecond=0)
    slot = client.post(
        f"/clinics/{setup['clinic'].clinic_id}/slots",
        json={"doctor_id": setup["doctor"].user_id, "datetimes": [dt.isoformat()], "appointment_type": "ONLINE"},
        headers=auth_header(setup["reg_token"]),
    ).json()[0]
    client.post(f"/appointments/{slot['appointment_id']}/book?as_patient={dep['patient_id']}",
                headers=auth_header(setup["patient_token"]))

    # opiekun może wysłać załącznik do pokoju wizyty podopiecznego (wcześniej 403)
    resp = client.post(
        f"/telemed/{slot['appointment_id']}/attachments",
        files={"file": ("wynik.txt", b"morfologia w normie", "text/plain")},
        headers=auth_header(setup["patient_token"]),
    )
    assert resp.status_code == 201
    url = resp.json()["url"]
    assert client.get(url, headers=auth_header(setup["patient_token"])).status_code == 200

    # obcy pacjent dalej nie ma dostępu
    _, other_token = factory.patient()
    assert client.get(url, headers=auth_header(other_token)).status_code == 403


def test_slot_poza_siatka_odrzucony(client, setup):
    # domyślna siatka 15 min — 10:07 nie przejdzie, 10:15 tak
    base = (datetime.now() + timedelta(days=9)).replace(hour=10, minute=7, second=0, microsecond=0)
    bad = client.post(
        f"/clinics/{setup['clinic'].clinic_id}/slots",
        json={"doctor_id": setup["doctor"].user_id, "datetimes": [base.isoformat()]},
        headers=auth_header(setup["reg_token"]),
    )
    assert bad.status_code == 422
    assert "siatce" in bad.json()["detail"]
    ok = client.post(
        f"/clinics/{setup['clinic'].clinic_id}/slots",
        json={"doctor_id": setup["doctor"].user_id, "datetimes": [base.replace(minute=15).isoformat()]},
        headers=auth_header(setup["reg_token"]),
    )
    assert ok.status_code == 201

    # zmiana siatki na 20 min: 10:15 już nie przejdzie, 10:20 tak
    client.patch(f"/clinics/{setup['clinic'].clinic_id}/settings",
                 json={"earlier_notice_min_hours": 24, "slot_interval_min": 20},
                 headers=auth_header(setup["reg_token"]))
    day2 = base + timedelta(days=1)
    assert client.post(
        f"/clinics/{setup['clinic'].clinic_id}/slots",
        json={"doctor_id": setup["doctor"].user_id, "datetimes": [day2.replace(minute=15).isoformat()]},
        headers=auth_header(setup["reg_token"]),
    ).status_code == 422
    assert client.post(
        f"/clinics/{setup['clinic'].clinic_id}/slots",
        json={"doctor_id": setup["doctor"].user_id, "datetimes": [day2.replace(minute=20).isoformat()]},
        headers=auth_header(setup["reg_token"]),
    ).status_code == 201


def test_usuwanie_wolnego_slotu(client, setup):
    dt = (datetime.now() + timedelta(days=3)).replace(hour=14, minute=0, second=0, microsecond=0)
    free = make_slots(client, setup, [dt.isoformat()])[0]
    booked = make_slots(client, setup, [(dt + timedelta(hours=1)).isoformat()])[0]
    client.post(f"/appointments/{booked['appointment_id']}/book", headers=auth_header(setup["patient_token"]))

    # pacjent nie usunie; rejestracja usunie tylko WOLNY slot
    assert client.delete(f"/slots/{free['appointment_id']}",
                         headers=auth_header(setup["patient_token"])).status_code == 403
    assert client.delete(f"/slots/{booked['appointment_id']}",
                         headers=auth_header(setup["reg_token"])).status_code == 409
    assert client.delete(f"/slots/{free['appointment_id']}",
                         headers=auth_header(setup["reg_token"])).status_code == 204
    assert client.get(f"/appointments/{free['appointment_id']}",
                      headers=auth_header(setup["doctor_token"])).status_code == 404


def test_karta_pacjenta_pokazuje_opiekuna(client, setup):
    dep = client.post("/family", json={
        "first_name": "Hania", "last_name": "Testowa",
        "pesel": "20210112342", "birth_date": "2021-01-01",
    }, headers=auth_header(setup["patient_token"])).json()

    info = client.get(f"/patients/{dep['patient_id']}", headers=auth_header(setup["doctor_token"])).json()
    assert info["guardian_name"] is not None
    assert info["guardian_phone"] == "601234567"  # telefon opiekuna z conftest

    # zwykły pacjent bez opiekuna
    own = client.get(f"/patients/{setup['patient'].user_id}", headers=auth_header(setup["doctor_token"])).json()
    assert own["guardian_name"] is None
