# Testy regresyjne dla napraw z audytu produkcyjnego (izolacja multi-tenant,
# integralność, granice bezpieczeństwa) + uzupełnienie luk pokrycia.
from datetime import datetime, timedelta, timezone

import jwt

from tests.conftest import TEST_SECRET, auth_header, make_token


def _confirmed_visit_in_clinic(client, factory, clinic_name="Placówka A"):
    """Pacjent z potwierdzoną wizytą w danej placówce (footprint = ta placówka)."""
    reg_user, reg_token = factory.user("rejestracja")
    doc_user, doc_token = factory.doctor()
    pat_user, pat_token = factory.patient()
    clinic = factory.clinic(clinic_name)
    factory.employ(clinic, doc_user.user_id)
    factory.employ(clinic, reg_user.user_id)
    dt = (datetime.now() + timedelta(days=2)).replace(hour=10, minute=0, second=0, microsecond=0)
    slot = client.post(
        f"/clinics/{clinic.clinic_id}/slots",
        json={"doctor_id": str(doc_user.user_id), "datetimes": [dt.isoformat()]},
        headers=auth_header(reg_token),
    ).json()[0]
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(pat_token))
    return {"clinic": clinic, "reg_token": reg_token, "doc_token": doc_token,
            "patient": pat_user, "patient_token": pat_token, "slot": slot}


def _reg_in_other_clinic(factory):
    reg_user, reg_token = factory.user("rejestracja")
    clinic_b = factory.clinic("Placówka B")
    factory.employ(clinic_b, reg_user.user_id)
    return reg_token


# ---------------------------------------------------------------- granice JWT
def test_token_wygasly_odrzucony_401(client):
    expired = jwt.encode(
        {"sub": "00000000-0000-0000-0000-000000000001", "email": "x@test.pl",
         "aud": "authenticated", "exp": datetime.now(timezone.utc) - timedelta(hours=1)},
        TEST_SECRET, algorithm="HS256")
    assert client.get("/auth/me", headers=auth_header(expired)).status_code == 401


def test_token_zla_audiencja_odrzucony_401(client):
    bad_aud = jwt.encode(
        {"sub": "00000000-0000-0000-0000-000000000002", "email": "x@test.pl",
         "aud": "anon", "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        TEST_SECRET, algorithm="HS256")
    assert client.get("/auth/me", headers=auth_header(bad_aud)).status_code == 401


# ---------------------------------------------------------------- IDOR
def test_idor_nie_anuluje_cudzej_wizyty(client, factory):
    s = _confirmed_visit_in_clinic(client, factory)
    _, intruz_token = factory.patient()  # inny pacjent
    r = client.post(f"/appointments/{s['slot']['appointment_id']}/cancel",
                    headers=auth_header(intruz_token))
    assert r.status_code == 403


# ---------------------------------------------------------------- izolacja multi-tenant (naprawy)
def test_register_nie_ujawnia_pii_pacjenta_obcej_placowki(client, factory):
    """#3 — /patients/register nie jest oracle PII: pacjent z footprintem w placówce A
    jest niedostępny dla rejestracji z placówki B (sam PESEL nie wystarcza)."""
    PESEL = "90010112349"  # poprawna suma kontrolna (90010112345 z fabryki ją oblewa)
    reg_a_user, reg_a = factory.user("rejestracja")
    doc_a, _ = factory.doctor()
    clinic_a = factory.clinic("Placówka A")
    factory.employ(clinic_a, reg_a_user.user_id)
    factory.employ(clinic_a, doc_a.user_id)
    reg = client.post("/patients/register", headers=auth_header(reg_a),
                      json={"first_name": "Jan", "last_name": "Kowalski", "pesel": PESEL,
                            "birth_date": "1990-01-01", "phone_number": "601234567"})
    assert reg.status_code == 201
    pid = reg.json()["patient_id"]
    # footprint w placówce A: book-for w slocie tej placówki
    dt = (datetime.now() + timedelta(days=2)).replace(hour=10, minute=0, second=0, microsecond=0)
    slot = client.post(f"/clinics/{clinic_a.clinic_id}/slots",
                       json={"doctor_id": str(doc_a.user_id), "datetimes": [dt.isoformat()]},
                       headers=auth_header(reg_a)).json()[0]
    client.post(f"/appointments/{slot['appointment_id']}/book-for",
                json={"patient_id": pid}, headers=auth_header(reg_a))
    # rejestracja z placówki B dedupuje po tym PESEL → 403 (footprint tylko w A)
    reg_b = _reg_in_other_clinic(factory)
    r = client.post("/patients/register", headers=auth_header(reg_b),
                    json={"first_name": "Jan", "last_name": "Kowalski", "pesel": PESEL,
                          "birth_date": "1990-01-01", "phone_number": "601234567"})
    assert r.status_code == 403


def test_settle_payment_izolacja_placowki(client, factory):
    """#7 — rejestracja z placówki B nie rozlicza wizyty z placówki A."""
    s = _confirmed_visit_in_clinic(client, factory)
    reg_b = _reg_in_other_clinic(factory)
    r = client.post(f"/appointments/{s['slot']['appointment_id']}/settle-payment",
                    headers=auth_header(reg_b), json={"invoice": False})
    assert r.status_code == 403


def test_book_for_nie_przypina_pacjenta_obcej_placowki(client, factory):
    """book-for — rejestracja z placówki B nie zarezerwuje swojego slotu dla pacjenta
    z footprintem wyłącznie w placówce A."""
    s = _confirmed_visit_in_clinic(client, factory)
    reg_b_user, reg_b_token = factory.user("rejestracja")
    doc_b_user, _ = factory.doctor()
    clinic_b = factory.clinic("Placówka B")
    factory.employ(clinic_b, reg_b_user.user_id)
    factory.employ(clinic_b, doc_b_user.user_id)
    dt = (datetime.now() + timedelta(days=3)).replace(hour=9, minute=0, second=0, microsecond=0)
    slot_b = client.post(
        f"/clinics/{clinic_b.clinic_id}/slots",
        json={"doctor_id": str(doc_b_user.user_id), "datetimes": [dt.isoformat()]},
        headers=auth_header(reg_b_token),
    ).json()[0]
    r = client.post(f"/appointments/{slot_b['appointment_id']}/book-for",
                    headers=auth_header(reg_b_token),
                    json={"patient_id": str(s["patient"].user_id)})
    assert r.status_code == 403


def test_add_lab_result_izolacja_placowki(client, factory):
    """#10 — rejestracja z placówki B nie dopnie wyniku do wizyty/pacjenta z placówki A."""
    s = _confirmed_visit_in_clinic(client, factory)
    reg_b = _reg_in_other_clinic(factory)
    r = client.post(f"/patients/{s['patient'].user_id}/lab-results", headers=auth_header(reg_b),
                    json={"appointment_id": s["slot"]["appointment_id"],
                          "test_type": "Morfologia", "test_description": "W normie."})
    assert r.status_code == 403
