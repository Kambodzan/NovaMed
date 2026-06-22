from datetime import datetime, timedelta

import pytest

from tests.conftest import auth_header


@pytest.fixture()
def setup(client, factory):
    """Klinika + zatrudniony lekarz + rejestracja + pacjent."""
    reg_user, reg_token = factory.user("rejestracja")
    doctor_user, doctor_token = factory.doctor(specialization="Kardiolog")
    patient_user, patient_token = factory.patient()
    clinic = factory.clinic()
    factory.employ(clinic, doctor_user.user_id)
    factory.employ(clinic, reg_user.user_id)
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


def test_pacjent_hold_i_rezerwacja(client, setup):
    """Hold w panelu pacjenta: slot blokuje się przy wejściu w formularz, a rezerwacja
    swoim tokenem przechodzi."""
    sid = make_slot(client, setup, hour=11)
    pt = auth_header(setup["patient_token"])
    h = client.post(f"/appointments/{sid}/hold", headers=pt)
    assert h.status_code == 200
    token = h.json()["hold_token"]
    r = client.post(f"/appointments/{sid}/book", json={"hold_token": token}, headers=pt)
    assert r.status_code == 200, r.text
    assert r.json()["appointment"]["appointment_status"] == "CONFIRMED"


def test_hold_blokuje_innego_uzytkownika(client, setup, factory):
    sid = make_slot(client, setup, hour=12)
    client.post(f"/appointments/{sid}/hold", headers=auth_header(setup["patient_token"]))
    _, other = factory.user("pacjent")
    # drugi nie zaholduje zajętego terminu
    assert client.post(f"/appointments/{sid}/hold", headers=auth_header(other)).status_code == 409
    # ani nie zarezerwuje cudzym/żadnym tokenem
    assert client.post(f"/appointments/{sid}/book", json={"hold_token": "nie-moj"},
                       headers=auth_header(other)).status_code == 409


def test_rejestracja_hold_i_book_for(client, setup):
    sid = make_slot(client, setup, hour=13)
    reg = auth_header(setup["reg_token"])
    token = client.post(f"/appointments/{sid}/hold", headers=reg).json()["hold_token"]
    r = client.post(f"/appointments/{sid}/book-for",
                    json={"patient_id": str(setup["patient"].user_id), "hold_token": token}, headers=reg)
    assert r.status_code == 200, r.text
    assert r.json()["appointment_status"] == "CONFIRMED"


def test_release_zwalnia_hold(client, setup):
    sid = make_slot(client, setup, hour=14)
    pt = auth_header(setup["patient_token"])
    token = client.post(f"/appointments/{sid}/hold", headers=pt).json()["hold_token"]
    assert client.post(f"/appointments/{sid}/release?hold_token={token}", headers=pt).json()["released"] is True
    # po zwolnieniu znów można zaholdować
    assert client.post(f"/appointments/{sid}/hold", headers=pt).status_code == 200


def test_wyszukiwanie_po_specjalizacji(client, setup, factory):
    make_slot(client, setup)
    resp = client.get("/slots?specialization=Kardiolog", headers=auth_header(setup["patient_token"]))
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    resp = client.get("/slots?specialization=Dermatolog", headers=auth_header(setup["patient_token"]))
    assert resp.json() == []


def test_tryb_slotu_online_dozwolony_lub_nie(client, setup):
    """Teleporada to wybór pacjenta dozwolony tylko, gdy slot na nią zezwala (allow_online).
    Na slocie tylko-stacjonarnym prośba o online jest IGNOROWANA (zostaje stacjonarnie)."""
    cid = setup["clinic"].clinic_id
    did = str(setup["doctor"].user_id)
    reg = auth_header(setup["reg_token"])
    pat = auth_header(setup["patient_token"])

    def slot(hour, allow_online):
        dt = (datetime.now() + timedelta(days=3)).replace(hour=hour, minute=0, second=0, microsecond=0)
        r = client.post(f"/clinics/{cid}/slots", headers=reg,
                        json={"doctor_id": did, "datetimes": [dt.isoformat()], "allow_online": allow_online})
        assert r.status_code == 201
        return r.json()[0]

    only_stat = slot(11, False)
    assert only_stat["allow_online"] is False
    r = client.post(f"/appointments/{only_stat['appointment_id']}/book", json={"online": True}, headers=pat)
    assert r.status_code == 200 and r.json()["appointment"]["appointment_type"] == "STATIONARY"

    can_online = slot(12, True)
    r = client.post(f"/appointments/{can_online['appointment_id']}/book", json={"online": True}, headers=pat)
    assert r.status_code == 200 and r.json()["appointment"]["appointment_type"] == "ONLINE"


def test_usluga_konsultacja_dziedziczy_teleporade(client, setup, db_session):
    """Slot usługowy dziedziczy allow_online z usługi — konsultacja-usługa z teleporadą
    może być wybrana jako wideo (badanie/USG miałoby allow_online=False)."""
    from app.models import DoctorService, Service
    svc = Service(clinic_id=setup["clinic"].clinic_id, name="Konsultacja kardiologiczna",
                  duration_min=20, price=None, referral_required=False, allow_online=True, active=True)
    db_session.add(svc)
    db_session.flush()
    db_session.add(DoctorService(doctor_id=setup["doctor"].user_id, service_id=svc.service_id))
    db_session.commit()
    dt = (datetime.now() + timedelta(days=4)).replace(hour=9, minute=0, second=0, microsecond=0)
    slot = client.post(f"/clinics/{setup['clinic'].clinic_id}/slots", headers=auth_header(setup["reg_token"]),
                       json={"doctor_id": str(setup["doctor"].user_id), "service_id": str(svc.service_id),
                             "datetimes": [dt.isoformat()]}).json()[0]
    assert slot["allow_online"] is True and slot["service_name"] == "Konsultacja kardiologiczna"
    r = client.post(f"/appointments/{slot['appointment_id']}/book", json={"online": True},
                    headers=auth_header(setup["patient_token"]))
    assert r.status_code == 200 and r.json()["appointment"]["appointment_type"] == "ONLINE"


def test_teleporada_zawsze_platna_online(client, setup, db_session, integration_fakes):
    """Teleporada (online) jest ZAWSZE płatna z góry online — nawet z pay_on_site=true idzie
    do bramki (TEMP_LOCK), nie potwierdza się jako „na miejscu". Po zapłacie → też e-mail."""
    from app.models import DoctorService, Service
    svc = Service(clinic_id=setup["clinic"].clinic_id, name="Konsultacja kardiologiczna (prywatnie)",
                  duration_min=20, price=200, referral_required=False, allow_online=True, active=True)
    db_session.add(svc)
    db_session.flush()
    db_session.add(DoctorService(doctor_id=setup["doctor"].user_id, service_id=svc.service_id))
    db_session.commit()
    dt = (datetime.now() + timedelta(days=5)).replace(hour=9, minute=0, second=0, microsecond=0)
    slot = client.post(f"/clinics/{setup['clinic'].clinic_id}/slots", headers=auth_header(setup["reg_token"]),
                       json={"doctor_id": str(setup["doctor"].user_id), "service_id": str(svc.service_id),
                             "datetimes": [dt.isoformat()]}).json()[0]
    # mimo pay_on_site=true → teleporada idzie do bramki online (TEMP_LOCK), nie „na miejscu"
    r = client.post(f"/appointments/{slot['appointment_id']}/book",
                    json={"online": True, "pay_on_site": True}, headers=auth_header(setup["patient_token"]))
    assert r.status_code == 200
    assert r.json()["appointment"]["appointment_type"] == "ONLINE"
    assert r.json()["appointment"]["appointment_status"] == "TEMP_LOCK"
    assert r.json()["payment"]["payment_status"] == "PENDING"
    integration_fakes.email.sent.clear()
    pay = client.post(f"/appointments/{slot['appointment_id']}/pay", json={"outcome": "success"},
                      headers=auth_header(setup["patient_token"]))
    assert pay.status_code == 200 and pay.json()["appointment"]["appointment_status"] == "CONFIRMED"
    assert integration_fakes.email.sent, "potwierdzenie powinno pójść też e-mailem"
    assert "teleporad" in integration_fakes.email.sent[-1]["body"].lower(), "mail teleporady niesie link do wideo"


def test_whitelista_odrzucona_platnosc_tylko_in_app(client, setup, db_session, integration_fakes):
    """Odrzucona płatność to przejściowy szum widoczny na ekranie: NIE idzie ani
    mailem, ani SMS-em — zostaje tylko in-app (dzwonek)."""
    from app.models import DoctorService, Service
    svc = Service(clinic_id=setup["clinic"].clinic_id, name="Konsultacja online",
                  duration_min=20, price=200, referral_required=False, allow_online=True, active=True)
    db_session.add(svc)
    db_session.flush()
    db_session.add(DoctorService(doctor_id=setup["doctor"].user_id, service_id=svc.service_id))
    db_session.commit()
    dt = (datetime.now() + timedelta(days=6)).replace(hour=10, minute=0, second=0, microsecond=0)
    slot = client.post(f"/clinics/{setup['clinic'].clinic_id}/slots", headers=auth_header(setup["reg_token"]),
                       json={"doctor_id": str(setup["doctor"].user_id), "service_id": str(svc.service_id),
                             "datetimes": [dt.isoformat()]}).json()[0]
    client.post(f"/appointments/{slot['appointment_id']}/book",
                json={"online": True}, headers=auth_header(setup["patient_token"]))
    integration_fakes.email.sent.clear()
    integration_fakes.sms.sent.clear()
    fail = client.post(f"/appointments/{slot['appointment_id']}/pay", json={"outcome": "failure"},
                       headers=auth_header(setup["patient_token"]))
    assert fail.status_code == 200
    assert not integration_fakes.email.sent, "odrzucona płatność nie powinna iść mailem"
    assert not integration_fakes.sms.sent, "odrzucona płatność nie powinna iść SMS-em"
    notifs = client.get("/notifications/my", headers=auth_header(setup["patient_token"])).json()
    assert any(n["notification_title"] == "Płatność odrzucona" for n in notifs), "ale in-app powiadomienie zostaje"


def test_meldowanie_pacjenta_przez_recepcje(client, factory):
    """Recepcja melduje przybyłego pacjenta + przydziela gabinet; lekarz to widzi.
    Cofnięcie czyści; pielęgniarka nie ma uprawnień (front-desk only)."""
    reg_user, reg = factory.user("rejestracja")
    doc_user, _ = factory.doctor()
    pat_user, pat = factory.patient()
    clinic = factory.clinic()
    factory.employ(clinic, reg_user.user_id)
    factory.employ(clinic, doc_user.user_id)
    dt = (datetime.now() + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
    slot = client.post(f"/clinics/{clinic.clinic_id}/slots", headers=auth_header(reg),
                       json={"doctor_id": str(doc_user.user_id), "datetimes": [dt.isoformat()]}).json()[0]
    aid = slot["appointment_id"]
    client.post(f"/appointments/{aid}/book", headers=auth_header(pat))
    # melduje z jawnym gabinetem 5
    r = client.post(f"/appointments/{aid}/arrival", headers=auth_header(reg), json={"room": "5"})
    assert r.status_code == 200 and r.json()["room"] == "5" and r.json()["checked_in_at"]
    # cofnięcie meldunku
    r2 = client.post(f"/appointments/{aid}/arrival", headers=auth_header(reg), json={"checked_in": False})
    assert r2.json()["checked_in_at"] is None and r2.json()["room"] is None

    # gabinet ze STAŁEJ konfiguracji lekarza: kierownik ustawia, recepcja melduje bez wpisywania
    kier_user, kier = factory.user("kierownik"); factory.employ(clinic, kier_user.user_id)
    assert client.patch(f"/clinics/{clinic.clinic_id}/doctors/{doc_user.user_id}/room",
                        headers=auth_header(kier), json={"room": "12"}).status_code == 200
    r3 = client.post(f"/appointments/{aid}/arrival", headers=auth_header(reg), json={})  # bez room
    assert r3.json()["room"] == "12"
    # gabinet widoczny w liście lekarzy placówki
    docs = client.get(f"/clinics/{clinic.clinic_id}/doctors", headers=auth_header(reg)).json()
    assert next(d for d in docs if d["doctor_id"] == str(doc_user.user_id))["room"] == "12"

    # pielęgniarka nie zamelduje ani nie ustawi gabinetu (governance)
    _, nurse = factory.user("pielegniarka")
    assert client.post(f"/appointments/{aid}/arrival", headers=auth_header(nurse), json={}).status_code == 403
    assert client.patch(f"/clinics/{clinic.clinic_id}/doctors/{doc_user.user_id}/room",
                        headers=auth_header(nurse), json={"room": "9"}).status_code == 403
    # gabinety ustawia RECEPCJA (gdzie dziś który lekarz siedzi — front-desk, nie admin)
    assert client.patch(f"/clinics/{clinic.clinic_id}/doctors/{doc_user.user_id}/room",
                        headers=auth_header(reg), json={"room": "9"}).status_code == 200


def test_lekarz_z_wieloma_specjalizacjami(client, factory):
    """Lekarz z kilkoma specjalizacjami jest znajdowany pod KAŻDĄ z nich,
    a slot wystawia pełną listę specjalizacji (UC-P3)."""
    _, reg = factory.user("rejestracja")
    doc_user, _ = factory.doctor(specialization=["Internista", "Kardiolog"])
    _, patient = factory.patient()
    clinic = factory.clinic()
    factory.employ(clinic, doc_user.user_id)

    from datetime import datetime, timedelta
    dt = (datetime.now() + timedelta(days=2)).replace(hour=10, minute=0, second=0, microsecond=0)
    r = client.post(f"/clinics/{clinic.clinic_id}/slots",
                    json={"doctor_id": str(doc_user.user_id), "datetimes": [dt.isoformat()]},
                    headers=auth_header(reg))
    assert r.status_code == 201
    assert sorted(r.json()[0]["specializations"]) == ["Internista", "Kardiolog"]

    h = auth_header(patient)
    assert len(client.get("/slots?specialization=Internista", headers=h).json()) == 1
    assert len(client.get("/slots?specialization=Kardiolog", headers=h).json()) == 1
    assert client.get("/slots?specialization=Dermatolog", headers=h).json() == []


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

    # informacyjne powiadomienie o nowym terminie (bez prośby o potwierdzenie)
    notifs = client.get("/notifications/my", headers=auth_header(setup["patient_token"])).json()
    assert any(n["notification_title"] == "Wizyta przełożona" for n in notifs)


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


def test_batch_przypomnienia_niepotwierdzonych(client, setup):
    """Pulpit: zbiorcze przypomnienie do niepotwierdzonych wizyt dnia."""
    reg = auth_header(setup["reg_token"])
    cid = setup["clinic"].clinic_id
    dt = (datetime.now() + timedelta(days=2)).replace(hour=10, minute=0, second=0, microsecond=0)
    slot = make_slot(client, setup, days_ahead=2, hour=10)
    client.post(f"/appointments/{slot}/book", headers=auth_header(setup["patient_token"]))
    day = dt.strftime("%Y-%m-%d")
    r = client.post(f"/clinics/{cid}/remind-unconfirmed?day={day}", headers=reg)
    assert r.status_code == 200 and r.json()["sent"] == 1
    # nikt poza personelem placówki
    assert client.post(f"/clinics/{cid}/remind-unconfirmed?day={day}", headers=auth_header(setup["patient_token"])).status_code == 403


def test_aktywne_wizyty_lekarza_niezaleznie_od_daty(client, setup):
    """Pasek „wizyta w toku": GET /appointments/active zwraca otwarte wizyty
    lekarza (IN_PROGRESS/PAUSED) bez względu na dzień terminu."""
    dt = auth_header(setup["doctor_token"])
    slot_id = make_slot(client, setup, days_ahead=5, hour=10)  # wizyta z PRZYSZŁOŚCI
    client.post(f"/appointments/{slot_id}/book", headers=auth_header(setup["patient_token"]))

    assert client.get("/appointments/active", headers=dt).json() == []  # jeszcze nie rozpoczęta
    client.post(f"/appointments/{slot_id}/status", json={"new_status": "IN_PROGRESS"}, headers=dt)
    active = client.get("/appointments/active", headers=dt).json()
    assert len(active) == 1 and active[0]["appointment_id"] == slot_id  # widoczna mimo przyszłej daty

    client.post(f"/appointments/{slot_id}/status", json={"new_status": "PAUSED"}, headers=dt)
    assert len(client.get("/appointments/active", headers=dt).json()) == 1  # wstrzymana też się liczy
    client.post(f"/appointments/{slot_id}/status", json={"new_status": "COMPLETED"}, headers=dt)
    assert client.get("/appointments/active", headers=dt).json() == []  # zakończona znika z paska


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


def test_odwolanie_badania_zachowuje_rodzaj_i_skierowanie(client, setup):
    """Re-pooling po odwołaniu badania zachowuje service_name i referral_required
    (inaczej powstaje osierocony, bookowalny bez skierowania slot)."""
    reg = auth_header(setup["reg_token"])
    dt = (datetime.now() + timedelta(days=3)).replace(hour=8, minute=0, second=0, microsecond=0)
    slot = client.post(f"/clinics/{setup['clinic'].clinic_id}/slots",
                       json={"datetimes": [dt.isoformat()], "service_name": "RTG klatki piersiowej"},
                       headers=reg).json()[0]
    assert slot["service_name"] == "RTG klatki piersiowej" and slot["referral_required"] is True
    client.post(f"/appointments/{slot['appointment_id']}/book", json={"external_referral": True},
                headers=auth_header(setup["patient_token"]))
    client.post(f"/appointments/{slot['appointment_id']}/cancel", headers=auth_header(setup["patient_token"]))

    freed = next(s for s in client.get(f"/slots?clinic_id={setup['clinic'].clinic_id}", headers=reg).json()
                 if s["service_name"] == "RTG klatki piersiowej")
    assert freed["referral_required"] is True and freed["appointment_status"] == "FREE"


def test_reschedule_innego_lekarza_odrzucony(client, setup, factory):
    """Nie wolno przełożyć wizyty na slot innego lekarza (płatność wędrowałaby gdzie indziej)."""
    doc2, _ = factory.doctor()
    factory.employ(setup["clinic"], doc2.user_id)
    old = make_slot(client, setup, days_ahead=3, hour=9)
    client.post(f"/appointments/{old}/book", headers=auth_header(setup["patient_token"]))
    dt = (datetime.now() + timedelta(days=4)).replace(hour=10, minute=0, second=0, microsecond=0)
    new = client.post(f"/clinics/{setup['clinic'].clinic_id}/slots",
                      json={"doctor_id": str(doc2.user_id), "datetimes": [dt.isoformat()]},
                      headers=auth_header(setup["reg_token"])).json()[0]["appointment_id"]
    r = client.post(f"/appointments/{old}/reschedule", json={"new_appointment_id": new},
                    headers=auth_header(setup["patient_token"]))
    assert r.status_code == 409 and "lekarza" in r.json()["detail"].lower()


def test_book_for_badanie_wymaga_skierowania(client, setup, integration_fakes):
    """Rejestracja umawia badanie NFZ: bez skierowania 409; papierowe oświadczenie na
    NFZ też 409 (refundacja tylko z realnym e-skierowaniem w P1); z kodem z P1 → 200."""
    reg = auth_header(setup["reg_token"])
    dt = (datetime.now() + timedelta(days=3)).replace(hour=8, minute=0, second=0, microsecond=0)
    slot = client.post(f"/clinics/{setup['clinic'].clinic_id}/slots",
                       json={"datetimes": [dt.isoformat()], "service_name": "USG jamy brzusznej"},
                       headers=reg).json()[0]
    assert slot["referral_required"] is True
    pid = str(setup["patient"].user_id)
    sid = slot["appointment_id"]
    # bez wskazania skierowania → 409
    assert client.post(f"/appointments/{sid}/book-for", json={"patient_id": pid}, headers=reg).status_code == 409
    # papierowe oświadczenie na NFZ nie daje refundacji → 409
    deny = client.post(f"/appointments/{sid}/book-for", json={"patient_id": pid, "external_referral": True}, headers=reg)
    assert deny.status_code == 409 and "e-skierowanie" in deny.json()["detail"]
    # z kodem e-skierowania z P1 → 200
    code = integration_fakes.p1.issue_referral(pesel="90010112345", doctor_pwz="1234567",
                                               icd10="I10", referral_type="LAB", notes="USG")
    r = client.post(f"/appointments/{sid}/book-for", json={"patient_id": pid, "p1_referral_code": code}, headers=reg)
    assert r.status_code == 200 and r.json()["appointment_status"] == "CONFIRMED"
