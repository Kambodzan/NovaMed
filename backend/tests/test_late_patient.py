# Spóźniony pacjent: NO_SHOW → IN_PROGRESS dozwolone
# tylko w dniu wizyty — „jednak przyszedł".
from datetime import datetime, timedelta

import pytest

from app.models import Appointment
from tests.conftest import auth_header


@pytest.fixture()
def setup(client, factory):
    doctor_user, doctor_token = factory.doctor()
    patient_user, _ = factory.patient()
    clinic = factory.clinic()
    factory.employ(clinic, doctor_user.user_id)
    return {"doctor": doctor_user, "doctor_token": doctor_token,
            "patient": patient_user, "clinic": clinic}


def make_visit(db_session, s, dt) -> int:
    a = Appointment(
        patient_id=s["patient"].user_id, doctor_id=s["doctor"].user_id,
        clinic_id=s["clinic"].clinic_id, appointment_datetime=dt,
        appointment_status="CONFIRMED", appointment_type="STATIONARY",
    )
    db_session.add(a)
    db_session.commit()
    return a.appointment_id


def test_spozniony_pacjent_jednak_przyszedl(client, setup, db_session):
    s = setup
    today = datetime.now().replace(hour=8, minute=0, second=0, microsecond=0)
    appt_id = make_visit(db_session, s, today)

    def status(new):
        return client.post(f"/appointments/{appt_id}/status",
                           json={"new_status": new}, headers=auth_header(s["doctor_token"]))

    assert status("NO_SHOW").status_code == 200
    # pacjent dotarł spóźniony — podejmujemy wizytę i normalnie kończymy
    assert status("IN_PROGRESS").status_code == 200
    assert status("COMPLETED").status_code == 200


def test_no_show_z_innego_dnia_zostaje(client, setup, db_session):
    s = setup
    yesterday = (datetime.now() - timedelta(days=1)).replace(hour=8, minute=0, second=0, microsecond=0)
    appt_id = make_visit(db_session, s, yesterday)

    client.post(f"/appointments/{appt_id}/status", json={"new_status": "NO_SHOW"},
                headers=auth_header(s["doctor_token"]))
    resp = client.post(f"/appointments/{appt_id}/status", json={"new_status": "IN_PROGRESS"},
                       headers=auth_header(s["doctor_token"]))
    assert resp.status_code == 409
    assert "dniu wizyty" in resp.json()["detail"]
    # inne wyjścia z NO_SHOW dalej zabronione
    resp = client.post(f"/appointments/{appt_id}/status", json={"new_status": "COMPLETED"},
                       headers=auth_header(s["doctor_token"]))
    assert resp.status_code == 409
