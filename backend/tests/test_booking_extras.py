from datetime import datetime, timedelta

import pytest

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


def make_slot(client, s, days_ahead=3, hour=10):
    dt = (datetime.now() + timedelta(days=days_ahead)).replace(hour=hour, minute=0, second=0, microsecond=0)
    return client.post(
        f"/clinics/{s['clinic'].clinic_id}/slots",
        json={"doctor_id": s["doctor"].user_id, "datetimes": [dt.isoformat()]},
        headers=auth_header(s["reg_token"]),
    ).json()[0]


def test_powod_wizyty_widoczny_dla_lekarza(client, setup):
    slot = make_slot(client, setup)
    resp = client.post(
        f"/appointments/{slot['appointment_id']}/book",
        json={"reason": "Od tygodnia duszności przy wysiłku", "notify_earlier": True},
        headers=auth_header(setup["patient_token"]),
    )
    assert resp.status_code == 200
    booked = resp.json()["appointment"]
    assert booked["notes"] == "Od tygodnia duszności przy wysiłku"
    assert booked["notify_earlier"] is True

    # lekarz widzi powód w szczegółach wizyty
    detail = client.get(f"/appointments/{slot['appointment_id']}", headers=auth_header(setup["doctor_token"])).json()
    assert "duszności" in detail["notes"]


def test_book_bez_body_dziala_jak_wczesniej(client, setup):
    slot = make_slot(client, setup, hour=12)
    resp = client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(setup["patient_token"]))
    assert resp.status_code == 200
    assert resp.json()["appointment"]["notes"] is None
    assert resp.json()["appointment"]["notify_earlier"] is False


def test_ics_eksport(client, setup):
    slot = make_slot(client, setup, days_ahead=4, hour=9)
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(setup["patient_token"]))

    resp = client.get(f"/appointments/{slot['appointment_id']}/ics", headers=auth_header(setup["patient_token"]))
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/calendar")
    body = resp.text
    assert "BEGIN:VCALENDAR" in body and "BEGIN:VEVENT" in body
    assert f"novamed-appointment-{slot['appointment_id']}" in body
    assert "SUMMARY:Wizyta:" in body


def test_ics_rbac(client, setup, factory):
    slot = make_slot(client, setup, days_ahead=5, hour=11)
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(setup["patient_token"]))
    _, other_token = factory.patient()
    assert client.get(f"/appointments/{slot['appointment_id']}/ics", headers=auth_header(other_token)).status_code == 403


def test_seria_cykliczna_tworzy_wszystkie_sloty(client, setup):
    # frontend rozwija „co tydzień ×N" do listy datetimes — backend przyjmuje całą serię
    base = (datetime.now() + timedelta(days=7)).replace(hour=8, minute=0, second=0, microsecond=0)
    dts = [(base + timedelta(weeks=i)).isoformat() for i in range(4)]
    resp = client.post(
        f"/clinics/{setup['clinic'].clinic_id}/slots",
        json={"doctor_id": setup["doctor"].user_id, "datetimes": dts},
        headers=auth_header(setup["reg_token"]),
    )
    assert resp.status_code == 201
    assert len(resp.json()) == 4


def test_seria_z_konfliktem_jest_atomowa(client, setup):
    base = (datetime.now() + timedelta(days=8)).replace(hour=8, minute=30, second=0, microsecond=0)
    first = client.post(
        f"/clinics/{setup['clinic'].clinic_id}/slots",
        json={"doctor_id": setup["doctor"].user_id, "datetimes": [(base + timedelta(weeks=1)).isoformat()]},
        headers=auth_header(setup["reg_token"]),
    )
    assert first.status_code == 201

    # seria 3 terminów, środkowy koliduje → 409 i ŻADEN z serii nie powstaje
    dts = [(base + timedelta(weeks=i)).isoformat() for i in range(3)]
    resp = client.post(
        f"/clinics/{setup['clinic'].clinic_id}/slots",
        json={"doctor_id": setup["doctor"].user_id, "datetimes": dts},
        headers=auth_header(setup["reg_token"]),
    )
    assert resp.status_code == 409

    day0 = base.date().isoformat()
    slots = client.get(f"/slots?clinic_id={setup['clinic'].clinic_id}", headers=auth_header(setup["patient_token"])).json()
    assert not any(s["appointment_datetime"].startswith(day0) for s in slots)
