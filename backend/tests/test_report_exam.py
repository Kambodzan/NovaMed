# Regresja: raport miesiąca nie wywala się, gdy w miesiącu jest zarezerwowane
# badanie (doctor_id NULL = pracownia, nie lekarz).
from datetime import datetime, timedelta

from app.models import Appointment
from tests.conftest import auth_header


def test_raport_z_badaniem_nie_wywala(client, factory, db_session):
    _, reg = factory.user("rejestracja")
    doctor_user, _ = factory.doctor()
    patient_user, _ = factory.patient()
    clinic = factory.clinic()
    factory.employ(clinic, doctor_user.user_id)

    when = datetime.now().replace(day=15, hour=10, minute=0, second=0, microsecond=0)
    # wizyta lekarska + badanie (pracownia, bez lekarza)
    db_session.add(Appointment(patient_id=patient_user.user_id, doctor_id=doctor_user.user_id,
                               clinic_id=clinic.clinic_id, appointment_datetime=when,
                               appointment_status="COMPLETED", appointment_type="STATIONARY"))
    db_session.add(Appointment(patient_id=patient_user.user_id, doctor_id=None,
                               clinic_id=clinic.clinic_id, appointment_datetime=when + timedelta(hours=1),
                               appointment_status="CONFIRMED", appointment_type="STATIONARY",
                               service_name="RTG klatki piersiowej"))
    db_session.commit()

    month = when.strftime("%Y-%m")
    resp = client.get(f"/clinics/{clinic.clinic_id}/reports?month={month}", headers=auth_header(reg))
    assert resp.status_code == 200, resp.text
    r = resp.json()
    assert r["total_booked"] == 2          # wizyta + badanie w obłożeniu placówki
    assert len(r["per_doctor"]) == 1       # ale per-lekarz tylko wizyta lekarska
    # CSV też nie wywala
    assert client.get(f"/clinics/{clinic.clinic_id}/reports/csv?month={month}",
                      headers=auth_header(reg)).status_code == 200
