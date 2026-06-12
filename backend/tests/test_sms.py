from datetime import datetime, timedelta

from tests.conftest import auth_header


def test_sms_przy_potwierdzeniu_wizyty(client, factory, integration_fakes):
    _, reg_token = factory.user("rejestracja")
    doctor_user, _ = factory.doctor()
    patient_user, patient_token = factory.patient()
    clinic = factory.clinic()
    factory.employ(clinic, doctor_user.user_id)

    dt = (datetime.now() + timedelta(days=2)).replace(hour=9, minute=0, second=0, microsecond=0)
    slot = client.post(
        f"/clinics/{clinic.clinic_id}/slots",
        json={"doctor_id": str(doctor_user.user_id), "datetimes": [dt.isoformat()]},
        headers=auth_header(reg_token),
    ).json()[0]
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(patient_token))

    # powiadomienie in-app + SMS na numer pacjenta
    assert len(integration_fakes.sms.sent) == 1
    sms = integration_fakes.sms.sent[0]
    assert sms["to"] == "601234567"
    assert sms["message"].startswith("NovaMed: Wizyta potwierdzona")


def test_sms_brak_numeru_nie_wysyla(client, factory, integration_fakes, db_session):
    _, reg_token = factory.user("rejestracja")
    doctor_user, _ = factory.doctor()
    patient_user, patient_token = factory.patient()
    patient_user.phone_number = None
    db_session.commit()
    clinic = factory.clinic()
    factory.employ(clinic, doctor_user.user_id)

    dt = (datetime.now() + timedelta(days=2)).replace(hour=10, minute=0, second=0, microsecond=0)
    slot = client.post(
        f"/clinics/{clinic.clinic_id}/slots",
        json={"doctor_id": str(doctor_user.user_id), "datetimes": [dt.isoformat()]},
        headers=auth_header(reg_token),
    ).json()[0]
    resp = client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(patient_token))
    assert resp.status_code == 200  # brak telefonu nie psuje rezerwacji
    assert integration_fakes.sms.sent == []
