# Przeszłe wolne terminy (nieodebrane) nie są dostępne: nie pojawiają się
# w /slots ani nie da się ich zarezerwować.
from datetime import datetime, timedelta

import pytest

from app.models import Appointment
from tests.conftest import auth_header


@pytest.fixture()
def setup(client, factory):
    doctor_user, _ = factory.doctor()
    patient_user, patient_token = factory.patient()
    clinic = factory.clinic()
    factory.employ(clinic, doctor_user.user_id)
    return {"doctor": doctor_user, "patient": patient_user,
            "patient_token": patient_token, "clinic": clinic}


def make_slot(db, s, dt) -> str:
    a = Appointment(
        patient_id=None, doctor_id=s["doctor"].user_id, clinic_id=s["clinic"].clinic_id,
        appointment_datetime=dt, appointment_status="FREE", appointment_type="STATIONARY",
    )
    db.add(a)
    db.commit()
    return str(a.appointment_id)


def test_przeszly_slot_nie_jest_w_wyszukiwaniu(client, setup, db_session):
    s = setup
    past_id = make_slot(db_session, s, datetime.now() - timedelta(days=2))
    future_id = make_slot(db_session, s, datetime.now() + timedelta(days=2))

    ids = [a["appointment_id"] for a in
           client.get("/slots", headers=auth_header(s["patient_token"])).json()]
    assert future_id in ids
    assert past_id not in ids


def test_przeszlego_slotu_nie_da_sie_zarezerwowac(client, setup, db_session):
    s = setup
    past_id = make_slot(db_session, s, datetime.now() - timedelta(hours=3))
    resp = client.post(f"/appointments/{past_id}/book", headers=auth_header(s["patient_token"]))
    assert resp.status_code == 409
    assert "minął" in resp.json()["detail"]
