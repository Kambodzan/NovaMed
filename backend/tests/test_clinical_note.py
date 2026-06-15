# Nota z wizyty (encounter note) — cykl EHR: szkic → podpis → blokada →
# uzupełnienia + audyt/wersjonowanie + RBAC.
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
    return {"clinic": clinic, "doctor": doctor_user, "doctor_token": doctor_token,
            "patient": patient_user, "patient_token": patient_token, "reg_token": reg_token,
            "factory": factory}


def booked_visit(client, s, days_ahead=1) -> str:
    # jutro 9:00 — zawsze w przyszłości, niezależnie od pory uruchomienia testów
    dt = (datetime.now() + timedelta(days=days_ahead)).replace(hour=9, minute=0, second=0, microsecond=0)
    slot = client.post(f"/clinics/{s['clinic'].clinic_id}/slots",
                       json={"doctor_id": str(s["doctor"].user_id), "datetimes": [dt.isoformat()]},
                       headers=auth_header(s["reg_token"])).json()[0]
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(s["patient_token"]))
    return slot["appointment_id"]


def test_cykl_noty_szkic_podpis_uzupelnienie(client, setup):
    s = setup
    aid = booked_visit(client, s)
    dt = auth_header(s["doctor_token"])

    # pusta nota — brak (EMPTY); zapis szkicu tworzy DRAFT
    assert client.get(f"/appointments/{aid}/note", headers=dt).json()["status"] == "EMPTY"
    r = client.put(f"/appointments/{aid}/note", json={"content": "Wywiad: kaszel."}, headers=dt)
    assert r.status_code == 200 and r.json()["status"] == "DRAFT"

    # kolejny zapis NADPISUJE (jedna nota na wizytę), nie tworzy nowej
    client.put(f"/appointments/{aid}/note", json={"content": "Wywiad: kaszel od 3 dni."}, headers=dt)
    note = client.get(f"/appointments/{aid}/note", headers=dt).json()
    assert note["content"] == "Wywiad: kaszel od 3 dni."

    # podpis blokuje edycję
    assert client.post(f"/appointments/{aid}/note/sign", headers=dt).json()["status"] == "SIGNED"
    assert client.put(f"/appointments/{aid}/note", json={"content": "zmiana"}, headers=dt).status_code == 409

    # uzupełnienie dopiero po podpisie
    r = client.post(f"/appointments/{aid}/note/addenda", json={"content": "Dołączono wynik RTG."}, headers=dt)
    assert r.status_code == 200
    note = client.get(f"/appointments/{aid}/note", headers=dt).json()
    assert len(note["addenda"]) == 1 and note["addenda"][0]["content"] == "Dołączono wynik RTG."

    # audyt: CREATED, 2×SAVED, SIGNED, ADDENDUM
    actions = [e["action"] for e in note["events"]]
    assert actions == ["CREATED", "SAVED", "SAVED", "SIGNED", "ADDENDUM"]


def test_uzupelnienie_tylko_po_podpisie(client, setup):
    s = setup
    aid = booked_visit(client, s)
    dt = auth_header(s["doctor_token"])
    client.put(f"/appointments/{aid}/note", json={"content": "szkic"}, headers=dt)
    # bez podpisu — addendum zabronione
    assert client.post(f"/appointments/{aid}/note/addenda", json={"content": "x"}, headers=dt).status_code == 409


def test_zakonczenie_wizyty_autopodpisuje(client, setup):
    s = setup
    aid = booked_visit(client, s)
    dt = auth_header(s["doctor_token"])
    client.post(f"/appointments/{aid}/status", json={"new_status": "IN_PROGRESS"}, headers=dt)
    client.put(f"/appointments/{aid}/note", json={"content": "Rozpoznanie: J06.9"}, headers=dt)
    client.post(f"/appointments/{aid}/status", json={"new_status": "COMPLETED"}, headers=dt)
    assert client.get(f"/appointments/{aid}/note", headers=dt).json()["status"] == "SIGNED"


def test_rbac_noty(client, setup, factory):
    s = setup
    aid = booked_visit(client, s)
    dt = auth_header(s["doctor_token"])
    client.put(f"/appointments/{aid}/note", json={"content": "szkic poufny"}, headers=dt)

    # obcy lekarz nie edytuje ani nie widzi cudzej noty (jako lekarz tej wizyty)
    _, other_doc = factory.doctor()
    assert client.put(f"/appointments/{aid}/note", json={"content": "hack"}, headers=auth_header(other_doc)).status_code == 403

    # pacjent NIE widzi szkicu (tylko podpisaną)
    assert client.get(f"/appointments/{aid}/note", headers=auth_header(s["patient_token"])).json()["status"] == "EMPTY"
    client.post(f"/appointments/{aid}/note/sign", headers=dt)
    pat = client.get(f"/appointments/{aid}/note", headers=auth_header(s["patient_token"])).json()
    assert pat["status"] == "SIGNED" and pat["content"] == "szkic poufny"
    assert pat["events"] == []  # pacjent nie widzi audytu


def test_uzupelnienie_od_innego_lekarza(client, setup, factory):
    s = setup
    aid = booked_visit(client, s)
    dt = auth_header(s["doctor_token"])
    client.put(f"/appointments/{aid}/note", json={"content": "Rozpoznanie: I10"}, headers=dt)
    client.post(f"/appointments/{aid}/note/sign", headers=dt)
    # inny lekarz (konsultujący) z TEJ SAMEJ placówki dodaje uzupełnienie — EHR pozwala
    other_user, other_token = factory.doctor()
    factory.employ(s["clinic"], other_user.user_id)
    r = client.post(f"/appointments/{aid}/note/addenda",
                    json={"content": "Konsultacja: bez przeciwwskazań."}, headers=auth_header(other_token))
    assert r.status_code == 200
    note = client.get(f"/appointments/{aid}/note", headers=auth_header(other_token)).json()
    assert note["addenda"][-1]["author_name"] == other_user.username


def test_nota_w_udostepnianiu_kodem(client, setup):
    s = setup
    aid = booked_visit(client, s)
    dt = auth_header(s["doctor_token"])
    client.put(f"/appointments/{aid}/note", json={"content": "Rozpoznanie: J45.0 astma"}, headers=dt)
    client.post(f"/appointments/{aid}/note/sign", headers=dt)

    # zakres ogólny — nota widoczna w udostępnieniu kodem
    share = client.post("/shares", json={"scope": "ALL"}, headers=auth_header(s["patient_token"])).json()
    shared = client.post("/shares/access", json={"code": share["access_code"]}, headers=dt).json()
    assert len(shared["notes"]) == 1 and "J45.0" in shared["notes"][0]["content"]

    # zakres tylko-recepty — bez not
    share2 = client.post("/shares", json={"scope": "PRESCRIPTION"}, headers=auth_header(s["patient_token"])).json()
    shared2 = client.post("/shares/access", json={"code": share2["access_code"]}, headers=dt).json()
    assert shared2["notes"] == []
