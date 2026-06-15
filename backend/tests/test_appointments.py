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


def make_slot(client, setup, days_ahead=3, hour=10, dt=None) -> int:
    if dt is None:
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
    # wizyta dziś za ~2 h (przyszła, ale w oknie <24h → polityka blokuje anulowanie)
    soon = (datetime.now() + timedelta(hours=2)).replace(minute=0, second=0, microsecond=0)
    slot_id = make_slot(client, setup, dt=soon)
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


def test_zmiana_statusu_idempotentna(client, setup):
    # podwójne „Rozpocznij" (wyścig Mój dzień ↔ Gabinet) nie może dawać błędu
    slot_id = make_slot(client, setup, days_ahead=2)
    client.post(f"/appointments/{slot_id}/book", headers=auth_header(setup["patient_token"]))
    first = client.post(f"/appointments/{slot_id}/status", json={"new_status": "IN_PROGRESS"},
                        headers=auth_header(setup["doctor_token"]))
    second = client.post(f"/appointments/{slot_id}/status", json={"new_status": "IN_PROGRESS"},
                         headers=auth_header(setup["doctor_token"]))
    assert first.status_code == 200 and second.status_code == 200
    assert second.json()["appointment_status"] == "IN_PROGRESS"


def test_rejestracja_umawia_pacjenta(client, setup):
    """UC-PP1: rejestracja zakłada konto dzwoniącego i umawia go na wolny termin."""
    reg = auth_header(setup["reg_token"])
    slot = make_slot(client, setup)

    # nowy dzwoniący — rejestracja zakłada konto-gościa
    r = client.post("/patients/register", headers=reg, json={
        "first_name": "Halina", "last_name": "Nowak", "pesel": "44051401359",
        "birth_date": "1944-05-14", "phone_number": "601234567",
    })
    assert r.status_code == 201, r.text
    assert r.json()["existing"] is False
    pid = r.json()["patient_id"]

    # ten sam PESEL drugi raz → ten sam pacjent (dedup, bez dubla)
    r2 = client.post("/patients/register", headers=reg, json={
        "first_name": "Halina", "last_name": "Nowak", "pesel": "44051401359",
        "birth_date": "1944-05-14", "phone_number": "601234567",
    })
    assert r2.status_code == 201 and r2.json()["existing"] is True and r2.json()["patient_id"] == pid

    # rezerwacja w imieniu pacjenta → CONFIRMED od razu
    b = client.post(f"/appointments/{slot}/book-for", headers=reg,
                    json={"patient_id": pid, "reason": "ból gardła"})
    assert b.status_code == 200, b.text
    assert b.json()["appointment_status"] == "CONFIRMED" and b.json()["patient_id"] == pid

    # zajęty termin → 409
    assert client.post(f"/appointments/{slot}/book-for", headers=reg,
                       json={"patient_id": pid}).status_code == 409

    # pacjent nie może umawiać w cudzym imieniu (to rola rejestracji)
    slot2 = make_slot(client, setup, hour=11)
    assert client.post(f"/appointments/{slot2}/book-for",
                       headers=auth_header(setup["patient_token"]),
                       json={"patient_id": pid}).status_code == 403


def test_rejestracja_odrzuca_bledny_pesel(client, setup):
    r = client.post("/patients/register", headers=auth_header(setup["reg_token"]), json={
        "first_name": "Jan", "last_name": "Test", "pesel": "12345678901",
        "birth_date": "1990-01-01", "phone_number": "601234567",
    })
    assert r.status_code == 422


def test_rejestracja_przeklada_w_oknie_24h(client, setup, db_session):
    """Recepcja przekłada cudzą wizytę nawet < 24 h (pacjent w tym oknie nie może)."""
    from app.models import Appointment

    old = Appointment(
        patient_id=setup["patient"].user_id, doctor_id=setup["doctor"].user_id,
        clinic_id=setup["clinic"].clinic_id, appointment_datetime=datetime.now() + timedelta(hours=2),
        appointment_status="CONFIRMED", appointment_type="STATIONARY",
    )
    db_session.add(old)
    db_session.commit()
    old_id = str(old.appointment_id)
    new_id = make_slot(client, setup, days_ahead=2, hour=10)

    # pacjent NIE może (< 24 h)
    assert client.post(f"/appointments/{old_id}/reschedule", json={"new_appointment_id": new_id},
                       headers=auth_header(setup["patient_token"])).status_code == 409
    # rejestracja MOŻE
    r = client.post(f"/appointments/{old_id}/reschedule", json={"new_appointment_id": new_id},
                    headers=auth_header(setup["reg_token"]))
    assert r.status_code == 200, r.text
    assert r.json()["appointment_id"] == new_id and r.json()["appointment_status"] == "CONFIRMED"


def test_przelozenie_przenosi_platnosc(client, setup, db_session):
    """Opłacona wizyta przenosi się na nowy termin tej samej ceny — bez ponownej zapłaty."""
    from app.models import Appointment, Payment

    def appt(days, price, status="FREE", patient=None):
        a = Appointment(
            patient_id=patient, doctor_id=setup["doctor"].user_id, clinic_id=setup["clinic"].clinic_id,
            appointment_datetime=datetime.now() + timedelta(days=days),
            appointment_status=status, appointment_type="STATIONARY", price=price,
        )
        db_session.add(a)
        db_session.flush()
        return a

    old = appt(3, 200, "CONFIRMED", setup["patient"].user_id)
    pay = Payment(appointment_id=old.appointment_id, amount=200, payment_status="PAID",
                  provider_ref="X", created_at=datetime.now(), paid_at=datetime.now())
    db_session.add(pay)
    cheaper, same = appt(4, 150), appt(5, 200)
    db_session.commit()
    old_id, pay_id = str(old.appointment_id), pay.payment_id
    hdr = auth_header(setup["patient_token"])

    # inna cena → 409 (stara wizyta zostaje nietknięta)
    assert client.post(f"/appointments/{old_id}/reschedule",
                       json={"new_appointment_id": str(cheaper.appointment_id)}, headers=hdr).status_code == 409
    # ta sama cena → 200, płatność wędruje na nowy termin
    r = client.post(f"/appointments/{old_id}/reschedule",
                    json={"new_appointment_id": str(same.appointment_id)}, headers=hdr)
    assert r.status_code == 200, r.text
    db_session.expire_all()
    assert str(db_session.get(Payment, pay_id).appointment_id) == str(same.appointment_id)


def test_grafik_dnia_placowki(client, setup):
    """Rejestracja widzi WSZYSTKIE terminy dnia placówki — wolne i zajęte."""
    reg = auth_header(setup["reg_token"])
    free_id = make_slot(client, setup, days_ahead=2, hour=8)
    booked_id = make_slot(client, setup, days_ahead=2, hour=9)
    client.post(f"/appointments/{booked_id}/book", headers=auth_header(setup["patient_token"]))
    day = (datetime.now() + timedelta(days=2)).strftime("%Y-%m-%d")
    cid = setup["clinic"].clinic_id

    rows = client.get(f"/clinics/{cid}/day?day={day}", headers=reg).json()
    statuses = {r["appointment_id"]: r["appointment_status"] for r in rows}
    assert statuses.get(free_id) == "FREE"
    assert statuses.get(booked_id) == "CONFIRMED"

    # pacjent i lekarz nie korzystają z grafiku placówki (to widok rejestracji)
    assert client.get(f"/clinics/{cid}/day?day={day}", headers=auth_header(setup["patient_token"])).status_code == 403
    assert client.get(f"/clinics/{cid}/day?day={day}", headers=auth_header(setup["doctor_token"])).status_code == 403


def test_waitlist_powiadomienie_przy_odwolaniu(client, setup, factory):
    """Odwołanie zwalnia termin → lista oczekujących tej specjalizacji dostaje
    powiadomienie i schodzi z listy (UC-P3 A1)."""
    b_user, b_token = factory.patient()
    # slot istnieje WCZEŚNIEJ niż zapis B (tworzenie slotu też powiadamia listę)
    slot = make_slot(client, setup, days_ahead=3, hour=8)
    client.post(f"/appointments/{slot}/book", headers=auth_header(setup["patient_token"]))
    # B zapisuje się na listę oczekujących do specjalizacji lekarza (Kardiolog)
    assert client.post("/waiting-list", json={"specialization": "Kardiolog"},
                       headers=auth_header(b_token)).status_code == 201
    # A odwołuje → termin wraca do puli → B powiadomiony i zdjęty z listy
    assert client.post(f"/appointments/{slot}/cancel", headers=auth_header(setup["patient_token"])).status_code == 200
    notifs = client.get("/notifications/my", headers=auth_header(b_token)).json()
    assert any("oczekiwania" in n["notification_title"].lower() for n in notifs)
    assert client.get("/waiting-list/my", headers=auth_header(b_token)).json() == []


def test_dostawka_walk_in(client, setup):
    """Lekarz przyjmuje pacjenta od ręki — tworzy wizytę „teraz" (CONFIRMED)."""
    dt = auth_header(setup["doctor_token"])
    pid = str(setup["patient"].user_id)
    r = client.post("/appointments/walk-in", json={"patient_id": pid}, headers=dt)
    assert r.status_code == 200, r.text
    assert r.json()["appointment_status"] == "CONFIRMED" and r.json()["patient_id"] == pid
    # pacjent nie tworzy dostawki
    assert client.post("/appointments/walk-in", json={"patient_id": pid},
                       headers=auth_header(setup["patient_token"])).status_code == 403
