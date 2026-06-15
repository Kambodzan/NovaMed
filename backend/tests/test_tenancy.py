"""Izolacja między placówkami: personel widzi tylko pacjentów swojej placówki,
a dostęp międzyplacówkowy wyłącznie za zgodą pacjenta (kod udostępnienia)."""
from datetime import datetime, timedelta

from tests.conftest import auth_header


def _booked_patient_in_clinic(client, factory):
    """Pacjent z wizytą w placówce A (footprint = klinika A)."""
    reg_user, reg_token = factory.user("rejestracja")
    doctor_user, doctor_token = factory.doctor()
    patient_user, patient_token = factory.patient()
    clinic_a = factory.clinic("Placówka A")
    factory.employ(clinic_a, doctor_user.user_id)
    factory.employ(clinic_a, reg_user.user_id)

    dt = (datetime.now() + timedelta(days=2)).replace(hour=10, minute=0, second=0, microsecond=0)
    slot = client.post(
        f"/clinics/{clinic_a.clinic_id}/slots",
        json={"doctor_id": str(doctor_user.user_id), "datetimes": [dt.isoformat()]},
        headers=auth_header(reg_token),
    ).json()[0]
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(patient_token))
    return patient_user, patient_token, clinic_a


def test_personel_obcej_placowki_nie_widzi_pacjenta(client, factory):
    patient_user, _, _ = _booked_patient_in_clinic(client, factory)

    # lekarz zatrudniony TYLKO w placówce B — nie ma dostępu do kartoteki pacjenta z A
    doc_b_user, doc_b_token = factory.doctor()
    clinic_b = factory.clinic("Placówka B")
    factory.employ(clinic_b, doc_b_user.user_id)

    hdr = auth_header(doc_b_token)
    pid = patient_user.user_id
    assert client.get(f"/patients/{pid}", headers=hdr).status_code == 403
    assert client.get(f"/patients/{pid}/documents", headers=hdr).status_code == 403
    assert client.get(f"/patients/{pid}/history", headers=hdr).status_code == 403
    assert client.get(f"/patients/{pid}/appointments", headers=hdr).status_code == 403


def test_kod_udostepnienia_omija_granice_placowki(client, factory):
    patient_user, patient_token, _ = _booked_patient_in_clinic(client, factory)
    doc_b_user, doc_b_token = factory.doctor()
    clinic_b = factory.clinic("Placówka B")
    factory.employ(clinic_b, doc_b_user.user_id)

    # bez kodu: brak dostępu
    assert client.get(f"/patients/{patient_user.user_id}", headers=auth_header(doc_b_token)).status_code == 403

    # pacjent udostępnia kod → lekarz z innej placówki widzi dokumentację (świadoma zgoda)
    share = client.post("/shares", json={"scope": "ALL"}, headers=auth_header(patient_token)).json()
    shared = client.post("/shares/access", json={"code": share["access_code"]},
                         headers=auth_header(doc_b_token))
    assert shared.status_code == 200
    assert shared.json()["patient_id"] == str(patient_user.user_id)


def test_swiezo_zarejestrowany_pacjent_bez_wizyt_dostepny(client, factory):
    """Pacjent bez śladu (brak wizyt/przypisania) jest dostępny dla personelu —
    inaczej rejestracja nie obsłużyłaby świeżo założonej kartoteki."""
    patient_user, _ = factory.patient()
    doc_user, doc_token = factory.doctor()
    clinic = factory.clinic()
    factory.employ(clinic, doc_user.user_id)
    assert client.get(f"/patients/{patient_user.user_id}", headers=auth_header(doc_token)).status_code == 200
