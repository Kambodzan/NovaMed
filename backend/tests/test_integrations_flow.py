from datetime import datetime, timedelta

import pytest

from tests.conftest import auth_header


@pytest.fixture()
def setup(client, factory):
    reg_user, reg_token = factory.user("rejestracja")
    doctor_user, doctor_token = factory.doctor()
    patient_user, patient_token = factory.patient()
    clinic = factory.clinic()
    factory.employ(clinic, doctor_user.user_id)
    factory.employ(clinic, reg_user.user_id)
    return {
        "clinic": clinic, "doctor": doctor_user, "doctor_token": doctor_token,
        "patient": patient_user, "patient_token": patient_token, "reg_token": reg_token,
    }


def make_slot(client, s, price=None, days_ahead=3, hour=10):
    dt = (datetime.now() + timedelta(days=days_ahead)).replace(hour=hour, minute=0, second=0, microsecond=0)
    body = {"doctor_id": str(s["doctor"].user_id), "datetimes": [dt.isoformat()]}
    if price is not None:
        body["price"] = price
    resp = client.post(f"/clinics/{s['clinic'].clinic_id}/slots", json=body, headers=auth_header(s["reg_token"]))
    assert resp.status_code == 201, resp.text
    return resp.json()[0]


# ---------- płatności (UC-O1) ----------

def test_platna_wizyta_sukces(client, setup):
    slot = make_slot(client, setup, price=200)
    assert slot["price"] == 200

    resp = client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(setup["patient_token"]))
    assert resp.status_code == 200
    body = resp.json()
    assert body["appointment"]["appointment_status"] == "TEMP_LOCK"
    assert body["payment"]["payment_status"] == "PENDING"
    assert body["payment"]["amount"] == 200

    # zablokowany slot nie jest widoczny w wyszukiwarce
    assert client.get("/slots", headers=auth_header(setup["patient_token"])).json() == []

    # blokada TEMP_LOCK ma widoczny dla pacjenta termin wygaśnięcia + status PENDING
    assert body["appointment"]["locked_until"] is not None
    assert body["appointment"]["payment_status"] == "PENDING"

    resp = client.post(
        f"/appointments/{slot['appointment_id']}/pay",
        json={"outcome": "success"}, headers=auth_header(setup["patient_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["appointment"]["appointment_status"] == "CONFIRMED"
    assert resp.json()["payment"]["payment_status"] == "PAID"
    assert resp.json()["appointment"]["payment_status"] == "PAID"
    assert resp.json()["appointment"]["locked_until"] is None  # po opłaceniu brak blokady

    # anulowanie opłaconej wizyty → zwrot (REFUNDED) widoczny u pacjenta
    c = client.post(f"/appointments/{slot['appointment_id']}/cancel", headers=auth_header(setup["patient_token"]))
    assert c.status_code == 200
    mine = client.get("/appointments/my", headers=auth_header(setup["patient_token"])).json()
    visit = next(v for v in mine if v["appointment_id"] == slot["appointment_id"])
    assert visit["appointment_status"] == "CANCELLED" and visit["payment_status"] == "REFUNDED"


def test_platna_wizyta_odmowa_zwalnia_slot(client, setup, factory):
    slot = make_slot(client, setup, price=150)
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(setup["patient_token"]))

    resp = client.post(
        f"/appointments/{slot['appointment_id']}/pay",
        json={"outcome": "failure"}, headers=auth_header(setup["patient_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["appointment"]["appointment_status"] == "FREE"
    assert resp.json()["appointment"]["patient_id"] is None
    assert resp.json()["payment"]["payment_status"] == "FAILED"

    # termin wrócił do puli — inny pacjent może go zarezerwować
    _, other_token = factory.patient()
    resp = client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(other_token))
    assert resp.status_code == 200
    assert resp.json()["appointment"]["appointment_status"] == "TEMP_LOCK"


def test_usuniecie_wolnego_slotu_z_osierocona_platnoscia(client, setup):
    """Regresja: wolny termin po nieudanej płatności ma osierocony wiersz payment —
    usunięcie slotu nie może wywalić się na FK (kiedyś 500)."""
    slot = make_slot(client, setup, price=150)
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(setup["patient_token"]))
    client.post(f"/appointments/{slot['appointment_id']}/pay",
                json={"outcome": "failure"}, headers=auth_header(setup["patient_token"]))
    resp = client.delete(f"/slots/{slot['appointment_id']}", headers=auth_header(setup["reg_token"]))
    assert resp.status_code == 204, resp.text


def test_pay_zabezpieczenia(client, setup, factory):
    slot = make_slot(client, setup, price=100)
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(setup["patient_token"]))

    # nie-właściciel → 403
    _, other_token = factory.patient()
    resp = client.post(f"/appointments/{slot['appointment_id']}/pay", json={"outcome": "success"}, headers=auth_header(other_token))
    assert resp.status_code == 403

    # po opłaceniu — kolejny pay → 409
    client.post(f"/appointments/{slot['appointment_id']}/pay", json={"outcome": "success"}, headers=auth_header(setup["patient_token"]))
    resp = client.post(f"/appointments/{slot['appointment_id']}/pay", json={"outcome": "success"}, headers=auth_header(setup["patient_token"]))
    assert resp.status_code == 409


def test_porzucenie_blokady_przez_cancel(client, setup):
    slot = make_slot(client, setup, price=120)
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(setup["patient_token"]))
    resp = client.post(f"/appointments/{slot['appointment_id']}/cancel", headers=auth_header(setup["patient_token"]))
    assert resp.status_code == 200
    assert resp.json()["appointment_status"] == "FREE"
    assert resp.json()["patient_id"] is None


def test_przelozenie_na_platny_slot_409(client, setup):
    free_slot = make_slot(client, setup, days_ahead=4, hour=9)
    paid_slot = make_slot(client, setup, price=180, days_ahead=5, hour=12)
    client.post(f"/appointments/{free_slot['appointment_id']}/book", headers=auth_header(setup["patient_token"]))
    resp = client.post(
        f"/appointments/{free_slot['appointment_id']}/reschedule",
        json={"new_appointment_id": paid_slot["appointment_id"]},
        headers=auth_header(setup["patient_token"]),
    )
    assert resp.status_code == 409


# ---------- eWUŚ (UC-I4) ----------

def test_ewus_weryfikacja_przy_rezerwacji(client, setup, integration_fakes):
    integration_fakes.ewus.insured = False
    slot = make_slot(client, setup)
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(setup["patient_token"]))

    assert len(integration_fakes.ewus.calls) == 1
    info = client.get(f"/patients/{setup['patient'].user_id}", headers=auth_header(setup["reg_token"])).json()
    assert info["insurance_status"] is False


def test_ewus_awaria_nie_blokuje_rezerwacji(client, setup, integration_fakes):
    integration_fakes.ewus.fail = True
    slot = make_slot(client, setup)
    resp = client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(setup["patient_token"]))
    assert resp.status_code == 200
    assert resp.json()["appointment"]["appointment_status"] == "CONFIRMED"


def test_ewus_reczna_weryfikacja(client, setup, integration_fakes):
    integration_fakes.ewus.insured = True
    resp = client.post(f"/patients/{setup['patient'].user_id}/verify-insurance", headers=auth_header(setup["reg_token"]))
    assert resp.status_code == 200
    assert resp.json()["insurance_status"] is True

    # pacjent nie weryfikuje sam
    resp = client.post(f"/patients/{setup['patient'].user_id}/verify-insurance", headers=auth_header(setup["patient_token"]))
    assert resp.status_code == 403


# ---------- laboratorium (UC-I2) ----------

def test_lab_zlecenie_i_synchronizacja(client, setup, integration_fakes):
    slot = make_slot(client, setup, days_ahead=2)
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(setup["patient_token"]))

    resp = client.post(
        f"/patients/{setup['patient'].user_id}/referrals",
        json={"appointment_id": slot["appointment_id"], "referral_type": "LAB", "icd10": "E78.0", "notes": "lipidogram"},
        headers=auth_header(setup["doctor_token"]),
    )
    assert resp.status_code == 201
    code = resp.json()["code"]

    # zlecenie zarejestrowane w laboratorium
    assert len(integration_fakes.lab.orders) == 1
    assert integration_fakes.lab.orders[0]["referral_code"] == code

    # laboratorium ma gotowy wynik → synchronizacja
    integration_fakes.lab.results = [{
        "referral_code": code, "test_type": "lipidogram",
        "result": "Cholesterol całk. 228 mg/dl • LDL 142 mg/dl",
        "analytes": [
            {"name": "Cholesterol całkowity", "value": 228, "unit": "mg/dl", "ref_low": None, "ref_high": 190},
            {"name": "HDL", "value": 55, "unit": "mg/dl", "ref_low": 40, "ref_high": None},
        ],
    }]
    resp = client.post("/integrations/lab/sync", headers=auth_header(setup["reg_token"]))
    assert resp.status_code == 200
    assert resp.json() == {"imported": 1, "skipped": 0}

    # wynik w dokumentacji pacjenta, skierowanie zrealizowane
    docs = client.get("/documents/my", headers=auth_header(setup["patient_token"])).json()
    types = {d["document_type"]: d for d in docs}
    assert types["LAB_RESULT"]["document_status"] == "READY"
    assert "Cholesterol" in types["LAB_RESULT"]["details"]
    assert types["REFERRAL"]["document_status"] == "REALIZED"
    # ustrukturyzowane wartości z zakresami referencyjnymi (do flagi „poza normą")
    vals = types["LAB_RESULT"]["lab_values"]
    assert len(vals) == 2
    chol = next(v for v in vals if v["name"] == "Cholesterol całkowity")
    assert chol["value"] == 228 and chol["ref_high"] == 190  # 228 > 190 → poza normą

    # wynik trafia do skrzynki „do opisania" lekarza ZLECAJĄCEGO + powiadomienie
    dt = auth_header(setup["doctor_token"])
    inbox = client.get("/documents/lab-inbox", headers=dt).json()
    assert len(inbox) == 1 and inbox[0]["document_type"] == "LAB_RESULT"
    res_id = inbox[0]["document_id"]
    notifs = client.get("/notifications/my", headers=dt).json()
    assert any("opisania" in n["notification_title"].lower() for n in notifs)

    # oznaczenie jako odebrane → znika ze skrzynki
    assert client.post(f"/documents/{res_id}/acknowledge", headers=dt).json()["document_status"] == "RECEIVED_BY_DOCTOR"
    assert client.get("/documents/lab-inbox", headers=dt).json() == []

    # ponowna synchronizacja → dedup
    resp = client.post("/integrations/lab/sync", headers=auth_header(setup["reg_token"]))
    assert resp.json() == {"imported": 0, "skipped": 1}

    # pacjent nie uruchomi synchronizacji
    assert client.post("/integrations/lab/sync", headers=auth_header(setup["patient_token"])).status_code == 403


# ---------- e-skierowanie z P1 przy rezerwacji (NFZ u specjalisty) ----------

def _referral_slot(client, setup, db_session, hour=9):
    """Slot u kardiologa wymagający skierowania (usługa NFZ „Konsultacja kardiologiczna")."""
    from app.models import DoctorService, Service
    svc = Service(clinic_id=setup["clinic"].clinic_id, name="Konsultacja kardiologiczna",
                  duration_min=20, price=None, referral_required=True, active=True)
    db_session.add(svc)
    db_session.flush()
    db_session.add(DoctorService(doctor_id=setup["doctor"].user_id, service_id=svc.service_id))
    db_session.commit()
    dt = (datetime.now() + timedelta(days=3)).replace(hour=hour, minute=0, second=0, microsecond=0)
    r = client.post(f"/clinics/{setup['clinic'].clinic_id}/slots",
                    json={"doctor_id": str(setup["doctor"].user_id), "service_id": str(svc.service_id),
                          "datetimes": [dt.isoformat()]},
                    headers=auth_header(setup["reg_token"]))
    assert r.status_code == 201, r.text
    slot = r.json()[0]
    assert slot["referral_required"] is True
    return slot


def test_p1_skierowanie_pasujace_realizuje(client, setup, integration_fakes, db_session):
    # e-skierowanie do Kardiologa w P1 (np. od lekarza rodzinnego), na PESEL pacjenta
    integration_fakes.p1.register_external_referral(code="SKR1", pesel="90010112345", specialization="Kardiolog")
    slot = _referral_slot(client, setup, db_session)
    r = client.post(f"/appointments/{slot['appointment_id']}/book",
                    json={"p1_referral_code": "SKR1"}, headers=auth_header(setup["patient_token"]))
    assert r.status_code == 200, r.text
    assert r.json()["appointment"]["appointment_status"] == "CONFIRMED"
    assert integration_fakes.p1._docs["SKR1"]["used"] is True  # zużyte (jednorazowe)
    # zrealizowane skierowanie zapisane w dokumentacji pacjenta (REALIZED, kod z P1)
    docs = client.get("/documents/my", headers=auth_header(setup["patient_token"])).json()
    ref = next((d for d in docs if d["document_type"] == "REFERRAL" and d["code"] == "SKR1"), None)
    assert ref is not None and ref["document_status"] == "REALIZED"


def test_p1_skierowanie_zla_specjalizacja_odrzucone(client, setup, integration_fakes, db_session):
    integration_fakes.p1.register_external_referral(code="DERM", pesel="90010112345", specialization="Dermatolog")
    slot = _referral_slot(client, setup, db_session)
    r = client.post(f"/appointments/{slot['appointment_id']}/book",
                    json={"p1_referral_code": "DERM"}, headers=auth_header(setup["patient_token"]))
    assert r.status_code == 409 and "innej poradni" in r.json()["detail"]
    assert integration_fakes.p1._docs["DERM"]["used"] is False  # nie zużyte


def test_p1_skierowanie_zly_pesel_odrzucone(client, setup, integration_fakes, db_session):
    integration_fakes.p1.register_external_referral(code="OBC", pesel="44051401359", specialization="Kardiolog")
    slot = _referral_slot(client, setup, db_session)
    r = client.post(f"/appointments/{slot['appointment_id']}/book",
                    json={"p1_referral_code": "OBC"}, headers=auth_header(setup["patient_token"]))
    assert r.status_code == 409 and "inny PESEL" in r.json()["detail"]


def test_p1_skierowanie_nieznany_kod_odrzucone(client, setup, integration_fakes, db_session):
    slot = _referral_slot(client, setup, db_session)
    r = client.post(f"/appointments/{slot['appointment_id']}/book",
                    json={"p1_referral_code": "NICEMA"}, headers=auth_header(setup["patient_token"]))
    assert r.status_code == 409 and "Nie znaleziono" in r.json()["detail"]


def test_nfz_odrzuca_papierowe_oswiadczenie(client, setup, db_session):
    """NFZ (termin bez ceny) — papierowe oświadczenie nie daje refundacji; tylko kod P1."""
    slot = _referral_slot(client, setup, db_session)  # usługa NFZ (price=None) ze skierowaniem
    r = client.post(f"/appointments/{slot['appointment_id']}/book",
                    json={"external_referral": True}, headers=auth_header(setup["patient_token"]))
    assert r.status_code == 409 and "e-skierowanie" in r.json()["detail"]


def test_platne_dopuszcza_papierowe_oswiadczenie(client, setup, db_session):
    """Płatne badanie ze skierowaniem (usługa z ceną) — papierowe oświadczenie jest OK
    (brak refundacji NFZ → nie wymuszamy realnego e-skierowania z P1)."""
    from app.models import DoctorService, Service
    svc = Service(clinic_id=setup["clinic"].clinic_id, name="TK głowy (prywatnie)",
                  duration_min=20, price=400, referral_required=True, active=True)
    db_session.add(svc)
    db_session.flush()
    db_session.add(DoctorService(doctor_id=setup["doctor"].user_id, service_id=svc.service_id))
    db_session.commit()
    dt = (datetime.now() + timedelta(days=3)).replace(hour=10, minute=0, second=0, microsecond=0)
    slot = client.post(f"/clinics/{setup['clinic'].clinic_id}/slots",
                       json={"doctor_id": str(setup["doctor"].user_id), "service_id": str(svc.service_id),
                             "datetimes": [dt.isoformat()]},
                       headers=auth_header(setup["reg_token"])).json()[0]
    assert slot["referral_required"] is True and slot["price"] == 400
    r = client.post(f"/appointments/{slot['appointment_id']}/book",
                    json={"external_referral": True}, headers=auth_header(setup["patient_token"]))
    assert r.status_code == 200  # płatne — oświadczenie dopuszczalne (slot przechodzi do płatności)
