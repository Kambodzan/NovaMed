from datetime import datetime, timedelta

import pytest

from tests.conftest import auth_header


@pytest.fixture()
def setup(client, factory):
    """Klinika + zatrudniony lekarz + rejestracja + pacjent."""
    _, reg_token = factory.user("rejestracja")
    doctor_user, doctor_token = factory.doctor(specialization="Kardiolog")
    patient_user, patient_token = factory.patient()
    clinic = factory.clinic()
    factory.employ(clinic, doctor_user.user_id)
    return {
        "clinic": clinic,
        "doctor": doctor_user, "doctor_token": doctor_token,
        "patient": patient_user, "patient_token": patient_token,
        "reg_token": reg_token,
    }


def make_slot(client, setup, days_ahead=3, hour=10) -> int:
    dt = (datetime.now() + timedelta(days=days_ahead)).replace(hour=hour, minute=0, second=0, microsecond=0)
    resp = client.post(
        f"/clinics/{setup['clinic'].clinic_id}/slots",
        json={"doctor_id": str(setup["doctor"].user_id), "datetimes": [dt.isoformat()]},
        headers=auth_header(setup["reg_token"]),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()[0]["appointment_id"]


def test_pacjent_nie_tworzy_slotow(client, setup):
    dt = (datetime.now() + timedelta(days=1)).isoformat()
    resp = client.post(
        f"/clinics/{setup['clinic'].clinic_id}/slots",
        json={"doctor_id": str(setup["doctor"].user_id), "datetimes": [dt]},
        headers=auth_header(setup["patient_token"]),
    )
    assert resp.status_code == 403


def test_konflikt_terminow_409(client, setup):
    make_slot(client, setup, days_ahead=3, hour=10)
    dt = (datetime.now() + timedelta(days=3)).replace(hour=10, minute=0, second=0, microsecond=0)
    resp = client.post(
        f"/clinics/{setup['clinic'].clinic_id}/slots",
        json={"doctor_id": str(setup["doctor"].user_id), "datetimes": [dt.isoformat()]},
        headers=auth_header(setup["reg_token"]),
    )
    assert resp.status_code == 409


def test_wyszukiwanie_po_specjalizacji(client, setup, factory):
    make_slot(client, setup)
    resp = client.get("/slots?specialization=Kardiolog", headers=auth_header(setup["patient_token"]))
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    resp = client.get("/slots?specialization=Dermatolog", headers=auth_header(setup["patient_token"]))
    assert resp.json() == []


def test_rezerwacja_i_podwojna_rezerwacja(client, setup, factory):
    slot_id = make_slot(client, setup)
    resp = client.post(f"/appointments/{slot_id}/book", headers=auth_header(setup["patient_token"]))
    assert resp.status_code == 200
    body = resp.json()["appointment"]
    assert body["appointment_status"] == "CONFIRMED"
    assert body["patient_name"] == "Jan Testowy"
    assert resp.json()["payment"] is None  # wizyta bezpłatna — bez płatności

    # drugi pacjent — termin zajęty
    _, other_token = factory.patient()
    assert client.post(f"/appointments/{slot_id}/book", headers=auth_header(other_token)).status_code == 409


def test_anulowanie_zwraca_slot_do_puli(client, setup):
    slot_id = make_slot(client, setup, days_ahead=5)
    client.post(f"/appointments/{slot_id}/book", headers=auth_header(setup["patient_token"]))

    resp = client.post(f"/appointments/{slot_id}/cancel", headers=auth_header(setup["patient_token"]))
    assert resp.status_code == 200
    assert resp.json()["appointment_status"] == "CANCELLED"

    # nowy wolny slot na ten sam termin jest z powrotem w wyszukiwarce
    resp = client.get("/slots", headers=auth_header(setup["patient_token"]))
    assert len(resp.json()) == 1
    assert resp.json()[0]["appointment_id"] != slot_id


def test_anulowanie_pozniej_niz_24h_409(client, setup):
    slot_id = make_slot(client, setup, days_ahead=0, hour=datetime.now().hour)  # dziś
    client.post(f"/appointments/{slot_id}/book", headers=auth_header(setup["patient_token"]))
    resp = client.post(f"/appointments/{slot_id}/cancel", headers=auth_header(setup["patient_token"]))
    assert resp.status_code == 409
    assert "24" in resp.json()["detail"]


def test_przelozenie_wizyty(client, setup):
    old_id = make_slot(client, setup, days_ahead=4, hour=9)
    new_id = make_slot(client, setup, days_ahead=5, hour=12)
    client.post(f"/appointments/{old_id}/book", headers=auth_header(setup["patient_token"]))

    resp = client.post(
        f"/appointments/{old_id}/reschedule",
        json={"new_appointment_id": new_id},
        headers=auth_header(setup["patient_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["appointment_id"] == new_id
    assert resp.json()["appointment_status"] == "CONFIRMED"

    # stary termin wrócił do puli jako nowy slot
    resp = client.get("/slots", headers=auth_header(setup["patient_token"]))
    times = [s["appointment_datetime"] for s in resp.json()]
    assert len(times) == 1


def test_dzien_lekarza_i_przebieg_wizyty(client, setup):
    slot_id = make_slot(client, setup, days_ahead=2, hour=8)
    client.post(f"/appointments/{slot_id}/book", headers=auth_header(setup["patient_token"]))

    day = (datetime.now() + timedelta(days=2)).strftime("%Y-%m-%d")
    resp = client.get(f"/appointments/day?day={day}", headers=auth_header(setup["doctor_token"]))
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    # CONFIRMED → IN_PROGRESS → COMPLETED
    for new_status in ["IN_PROGRESS", "COMPLETED"]:
        resp = client.post(
            f"/appointments/{slot_id}/status",
            json={"new_status": new_status},
            headers=auth_header(setup["doctor_token"]),
        )
        assert resp.status_code == 200, resp.text

    # nielegalne przejście ze stanu końcowego
    resp = client.post(
        f"/appointments/{slot_id}/status",
        json={"new_status": "IN_PROGRESS"},
        headers=auth_header(setup["doctor_token"]),
    )
    assert resp.status_code == 409


def test_szczegoly_wizyty_i_historia_pacjenta(client, setup, factory):
    slot_id = make_slot(client, setup, days_ahead=2, hour=14)
    client.post(f"/appointments/{slot_id}/book", headers=auth_header(setup["patient_token"]))

    # uczestnicy i personel widzą szczegóły
    assert client.get(f"/appointments/{slot_id}", headers=auth_header(setup["patient_token"])).status_code == 200
    assert client.get(f"/appointments/{slot_id}", headers=auth_header(setup["doctor_token"])).status_code == 200
    # obcy pacjent — nie
    _, other_token = factory.patient()
    assert client.get(f"/appointments/{slot_id}", headers=auth_header(other_token)).status_code == 403

    # historia wizyt pacjenta dla personelu; pacjent nie ma dostępu do tego endpointu
    resp = client.get(f"/patients/{setup['patient'].user_id}/appointments", headers=auth_header(setup["reg_token"]))
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert client.get(
        f"/patients/{setup['patient'].user_id}/appointments", headers=auth_header(setup["patient_token"]),
    ).status_code == 403


def test_lekarz_nie_zmienia_cudzych_wizyt(client, setup, factory):
    slot_id = make_slot(client, setup, days_ahead=2)
    client.post(f"/appointments/{slot_id}/book", headers=auth_header(setup["patient_token"]))
    _, other_doctor_token = factory.doctor()
    resp = client.post(
        f"/appointments/{slot_id}/status",
        json={"new_status": "IN_PROGRESS"},
        headers=auth_header(other_doctor_token),
    )
    assert resp.status_code == 403
