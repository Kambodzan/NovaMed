# Potwierdzanie obecności przed wizytą (ustawienie per placówka):
# prośba X godzin przed terminem + potwierdzenie przez pacjenta.
from datetime import datetime, timedelta

import pytest

from app.domain.reminders import send_confirmation_requests
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


def enable_confirmation(client, s, hours=48):
    resp = client.patch(
        f"/clinics/{s['clinic'].clinic_id}/settings",
        json={"earlier_notice_min_hours": 24, "slot_interval_min": 15,
              "confirmation_required": True, "confirmation_hours": hours},
        headers=auth_header(s["reg_token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["confirmation_required"] is True
    assert resp.json()["confirmation_hours"] == hours


def book_at(client, s, dt) -> int:
    slot = client.post(
        f"/clinics/{s['clinic'].clinic_id}/slots",
        json={"doctor_id": s["doctor"].user_id, "datetimes": [dt.isoformat()]},
        headers=auth_header(s["reg_token"]),
    ).json()[0]
    resp = client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(s["patient_token"]))
    assert resp.status_code == 200, resp.text
    return slot["appointment_id"]


def test_prosba_o_potwierdzenie_w_oknie(client, setup, db_session):
    s = setup
    enable_confirmation(client, s, hours=48)
    near = (datetime.now() + timedelta(hours=30)).replace(minute=0, second=0, microsecond=0)
    far = (datetime.now() + timedelta(days=5)).replace(minute=0, second=0, microsecond=0)
    near_id = book_at(client, s, near)
    book_at(client, s, far)

    assert send_confirmation_requests(db_session) == 1  # tylko wizyta w oknie 48h
    notifs = client.get("/notifications/my", headers=auth_header(s["patient_token"])).json()
    assert any(n["notification_title"] == "Potwierdź swoją wizytę" for n in notifs)
    # idempotencja
    assert send_confirmation_requests(db_session) == 0

    my = client.get("/appointments/my", headers=auth_header(s["patient_token"])).json()
    mine = next(a for a in my if a["appointment_id"] == near_id)
    assert mine["confirmation_requested"] is True and mine["patient_confirmed"] is False


def test_placowka_bez_wymogu_nie_wysyla(client, setup, db_session):
    s = setup  # confirmation_required domyślnie False
    book_at(client, s, (datetime.now() + timedelta(hours=20)).replace(minute=0, second=0, microsecond=0))
    assert send_confirmation_requests(db_session) == 0


def test_pacjent_potwierdza_obecnosc(client, setup, factory):
    s = setup
    enable_confirmation(client, s)
    appt_id = book_at(client, s, (datetime.now() + timedelta(hours=30)).replace(minute=0, second=0, microsecond=0))

    # obcy pacjent nie może
    _, other_token = factory.patient()
    assert client.post(f"/appointments/{appt_id}/confirm-attendance", headers=auth_header(other_token)).status_code == 403

    resp = client.post(f"/appointments/{appt_id}/confirm-attendance", headers=auth_header(s["patient_token"]))
    assert resp.status_code == 200, resp.text
    assert resp.json()["patient_confirmed"] is True

    # lekarz widzi potwierdzenie w grafiku dnia
    day = (datetime.now() + timedelta(hours=30)).strftime("%Y-%m-%d")
    sched = client.get("/appointments/day", params={"day": day}, headers=auth_header(s["doctor_token"]))
    assert sched.status_code == 200
    assert any(a["patient_confirmed"] for a in sched.json())


def test_wolnego_slotu_nie_da_sie_potwierdzic(client, setup):
    s = setup
    dt = (datetime.now() + timedelta(days=2)).replace(hour=9, minute=0, second=0, microsecond=0)
    slot = client.post(
        f"/clinics/{s['clinic'].clinic_id}/slots",
        json={"doctor_id": s["doctor"].user_id, "datetimes": [dt.isoformat()]},
        headers=auth_header(s["reg_token"]),
    ).json()[0]
    resp = client.post(f"/appointments/{slot['appointment_id']}/confirm-attendance", headers=auth_header(s["patient_token"]))
    assert resp.status_code in (403, 409)  # nie jego wizyta (FREE → patient_id NULL) / zły status
