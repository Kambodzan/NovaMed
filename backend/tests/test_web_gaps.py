from datetime import datetime, timedelta

import pytest

from app.domain.reminders import send_due_reminders
from tests.conftest import auth_header


@pytest.fixture()
def setup(client, factory):
    _, reg_token = factory.user("rejestracja")
    _, admin_token = factory.user("administrator")
    doctor_user, doctor_token = factory.doctor()
    patient_user, patient_token = factory.patient()
    _, nurse_token = factory.user("pielegniarka")
    clinic = factory.clinic()
    factory.employ(clinic, doctor_user.user_id)
    return {
        "clinic": clinic, "doctor": doctor_user, "doctor_token": doctor_token,
        "patient": patient_user, "patient_token": patient_token,
        "reg_token": reg_token, "nurse_token": nurse_token, "admin_token": admin_token,
    }


def test_reminder_mode_3_pozycyjny(client, setup, db_session):
    """Tryb przypomnień NONE/REMINDER/CONFIRM: NONE pomija przypomnienia 24h,
    CONFIRM wysyła i synchronizuje confirmation_required."""
    from app.domain.reminders import send_due_reminders
    from app.domain.appointments import AppointmentStatus
    from app.models import Appointment, Clinic
    s = setup
    cid = s["clinic"].clinic_id
    base = {"earlier_notice_min_hours": 24, "slot_interval_min": 15}

    r = client.patch(f"/clinics/{cid}/settings", headers=auth_header(s["admin_token"]), json={**base, "reminder_mode": "NONE"})
    assert r.status_code == 200 and r.json()["reminder_mode"] == "NONE" and r.json()["confirmation_required"] is False

    a = Appointment(patient_id=s["patient"].user_id, doctor_id=s["doctor"].user_id, clinic_id=cid,
                    appointment_datetime=datetime.now() + timedelta(hours=12),
                    appointment_status=AppointmentStatus.CONFIRMED.value, appointment_type="STATIONARY")
    db_session.add(a)
    db_session.commit()
    assert send_due_reminders(db_session) == 0  # NONE → brak przypomnień

    client.patch(f"/clinics/{cid}/settings", headers=auth_header(s["admin_token"]), json={**base, "reminder_mode": "CONFIRM"})
    assert db_session.get(Clinic, cid).confirmation_required is True  # zsynchronizowane
    db_session.refresh(a); a.reminder_sent = False; db_session.commit()
    assert send_due_reminders(db_session) == 1  # CONFIRM (≠NONE) → wysyła


def test_potwierdzenie_wizyty_z_linka(client, setup, db_session):
    """Potwierdzenie/odwołanie wizyty z linka SMS (token, bez logowania)."""
    import uuid
    from app.domain.confirm import ensure_confirm_token
    from app.models import Appointment
    s = setup

    def booked(hour):
        dt = (datetime.now() + timedelta(days=2)).replace(hour=hour, minute=0, second=0, microsecond=0)
        slot = client.post(f"/clinics/{s['clinic'].clinic_id}/slots",
                           json={"doctor_id": str(s["doctor"].user_id), "datetimes": [dt.isoformat()]},
                           headers=auth_header(s["reg_token"])).json()[0]
        client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(s["patient_token"]))
        a = db_session.get(Appointment, uuid.UUID(slot["appointment_id"]))
        tok = ensure_confirm_token(a)
        db_session.commit()
        return slot["appointment_id"], tok

    _, token = booked(9)
    # publiczny podgląd bez logowania
    v = client.get(f"/public/visit/{token}")
    assert v.status_code == 200 and v.json()["confirmed"] is False and v.json()["patient_name"]
    # potwierdzenie
    r = client.post(f"/public/visit/{token}/confirm")
    assert r.status_code == 200 and r.json()["confirmed"] is True
    # zły token → 404
    assert client.get("/public/visit/nieistniejacy").status_code == 404

    # odwołanie z linka — inna wizyta
    _, token2 = booked(11)
    rc = client.post(f"/public/visit/{token2}/cancel")
    assert rc.status_code == 200 and rc.json()["status"] == "CANCELLED"


def test_wynik_z_papieru_bez_wizyty(client, setup):
    """UC-PP3: rejestracja przyjmuje wynik „z papieru" luzem — bez wizyty/lekarza
    — i ląduje on w dokumentacji pacjenta (z wartościami parametrów)."""
    s = setup
    pid = s["patient"].user_id
    r = client.post(f"/patients/{pid}/lab-results", headers=auth_header(s["reg_token"]), json={
        "test_type": "Morfologia krwi",
        "test_description": "wartości w normie",
        "values": [{"name": "Hemoglobina", "value": 14.2, "unit": "g/dl", "ref_low": 12, "ref_high": 16}],
    })
    assert r.status_code == 201, r.text
    doc = r.json()
    assert doc["document_type"] == "LAB_RESULT" and doc["appointment_id"] is None
    assert doc["lab_values"] and doc["lab_values"][0]["name"] == "Hemoglobina"
    # widoczny w dokumentacji pacjenta
    docs = client.get("/documents/my", headers=auth_header(s["patient_token"])).json()
    assert any(d["document_id"] == doc["document_id"] for d in docs)


def test_wynik_oznaczany_jako_obejrzany(client, setup):
    """Wynik startuje jako nieobejrzany (nowy); pacjent oznacza go obejrzanym."""
    s = setup
    pid = s["patient"].user_id
    doc = client.post(f"/patients/{pid}/lab-results", headers=auth_header(s["reg_token"]),
                      json={"test_type": "TSH", "test_description": "w normie"}).json()
    did = doc["document_id"]
    assert doc["seen"] is False
    mine = client.get("/documents/my", headers=auth_header(s["patient_token"])).json()
    assert next(d for d in mine if d["document_id"] == did)["seen"] is False
    # pacjent oznacza obejrzany → seen=True (idempotentnie)
    r = client.post(f"/documents/{did}/seen", headers=auth_header(s["patient_token"]))
    assert r.status_code == 200 and r.json()["seen"] is True
    mine2 = client.get("/documents/my", headers=auth_header(s["patient_token"])).json()
    assert next(d for d in mine2 if d["document_id"] == did)["seen"] is True


def make_visit_with_prescription(client, s) -> int:
    dt = (datetime.now() + timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0)
    slot = client.post(
        f"/clinics/{s['clinic'].clinic_id}/slots",
        json={"doctor_id": str(s["doctor"].user_id), "datetimes": [dt.isoformat()]},
        headers=auth_header(s["reg_token"]),
    ).json()[0]
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(s["patient_token"]))
    resp = client.post(
        f"/patients/{s['patient'].user_id}/prescriptions",
        json={"appointment_id": slot["appointment_id"], "icd10": "I10", "drugs": "Atorvasterol 40 mg ×30 — D.S. 1×1"},
        headers=auth_header(s["doctor_token"]),
    )
    return resp.json()["document_id"]


# ---------- UC-P6: udostępnianie kodem ----------

def test_udostepnianie_kodem_pelny_cykl(client, setup):
    """UC-P6 (model trwałego dostępu): kod aktywuje TRWAŁY dostęp dla pierwszego
    pracownika, który go użyje; potem widzi pacjenta bez kodu, aż pacjent cofnie."""
    s = setup
    make_visit_with_prescription(client, s)

    # pacjent generuje kod (bez wyboru ważności — okno na odebranie jest stałe = 1h)
    resp = client.post("/shares", json={"scope": "ALL"}, headers=auth_header(s["patient_token"]))
    assert resp.status_code == 201, resp.text
    share = resp.json()
    assert len(share["access_code"]) == 7 and share["access_code"][3] == "-"
    assert share["recipient_name"] is None  # jeszcze nieodebrany

    # lekarz odbiera kod → zostaje przypięty jako odbiorca
    resp = client.post("/shares/access", json={"code": share["access_code"]}, headers=auth_header(s["doctor_token"]))
    assert resp.status_code == 200
    shared = resp.json()
    assert shared["pesel"] == "90010112345" and len(shared["documents"]) == 1
    assert shared["granted_at"] is not None and shared["share_id"] == share["share_id"]

    # ten sam lekarz wchodzi PONOWNIE tym samym kodem — trwały dostęp, OK
    assert client.post("/shares/access", json={"code": share["access_code"]}, headers=auth_header(s["doctor_token"])).status_code == 200

    # pielęgniarka tym samym (już odebranym) kodem — 403, kod jednorazowy w użyciu
    assert client.post("/shares/access", json={"code": share["access_code"]}, headers=auth_header(s["nurse_token"])).status_code == 403
    # pacjent nie ma roli personelu
    assert client.post("/shares/access", json={"code": share["access_code"]}, headers=auth_header(s["patient_token"])).status_code == 403

    # lekarz ma teraz pacjenta na liście „udostępnione mi" i wchodzi BEZ kodu
    granted = client.get("/shares/granted", headers=auth_header(s["doctor_token"])).json()
    assert len(granted) == 1 and granted[0]["share_id"] == share["share_id"]
    assert client.get(f"/shares/granted/{share['share_id']}", headers=auth_header(s["doctor_token"])).status_code == 200
    # cudzy pracownik (pielęgniarka) nie wejdzie w trwały dostęp lekarza
    assert client.get(f"/shares/granted/{share['share_id']}", headers=auth_header(s["nurse_token"])).status_code == 404

    # u pacjenta dostęp widnieje z nazwiskiem odbiorcy
    mine = client.get("/shares/my", headers=auth_header(s["patient_token"])).json()
    assert len(mine) == 1 and mine[0]["recipient_name"]

    # pacjent cofa dostęp (UC-P6 A1) → lekarz traci i kod, i trwały wgląd
    client.delete(f"/shares/{share['share_id']}", headers=auth_header(s["patient_token"]))
    assert client.get("/shares/my", headers=auth_header(s["patient_token"])).json() == []
    assert client.get("/shares/granted", headers=auth_header(s["doctor_token"])).json() == []
    assert client.get(f"/shares/granted/{share['share_id']}", headers=auth_header(s["doctor_token"])).status_code == 410
    resp = client.post("/shares/access", json={"code": share["access_code"]}, headers=auth_header(s["doctor_token"]))
    assert resp.status_code == 410 and "unieważniony" in resp.json()["detail"]
    # kod, którego nigdy nie było → 404
    assert client.post("/shares/access", json={"code": "XXX-999"}, headers=auth_header(s["doctor_token"])).status_code == 404


def test_udostepnianie_kod_wygasa_przed_odebraniem(client, setup, db_session):
    """Nieodebrany kod traci ważność po oknie 1h na odebranie."""
    import uuid
    from datetime import datetime, timedelta
    from app.models import DocumentShare
    s = setup
    make_visit_with_prescription(client, s)
    share = client.post("/shares", json={"scope": "ALL"}, headers=auth_header(s["patient_token"])).json()

    # cofamy expires_at w przeszłość (symulacja minięcia okna na odebranie)
    row = db_session.get(DocumentShare, uuid.UUID(share["share_id"]))
    row.expires_at = datetime.now() - timedelta(minutes=1)
    db_session.commit()

    # nieodebrany, po oknie → 410
    assert client.post("/shares/access", json={"code": share["access_code"]}, headers=auth_header(s["doctor_token"])).status_code == 410


def test_udostepnianie_zakres_filtruje(client, setup):
    s = setup
    make_visit_with_prescription(client, s)
    # zakres LAB_RESULT — recepta nie powinna być widoczna
    share = client.post("/shares", json={"scope": "LAB_RESULT"}, headers=auth_header(s["patient_token"])).json()
    shared = client.post("/shares/access", json={"code": share["access_code"]}, headers=auth_header(s["doctor_token"])).json()
    assert shared["documents"] == []


def test_udostepnianie_podglad(client, setup):
    s = setup
    make_visit_with_prescription(client, s)
    pt = auth_header(s["patient_token"])
    # podgląd „co zobaczy odbiorca" — 1 recepta, 0 notatek (brak podpisanej noty)
    prev = client.get("/shares/preview?scope=ALL", headers=pt).json()
    assert prev["document_count"] == 1 and prev["note_count"] == 0
    # zakres LAB_RESULT — recepta poza zakresem
    assert client.get("/shares/preview?scope=LAB_RESULT", headers=pt).json()["document_count"] == 0
    # podgląd to akcja pacjenta
    assert client.get("/shares/preview?scope=ALL", headers=auth_header(s["doctor_token"])).status_code == 403


def test_zly_kod_404(client, setup):
    resp = client.post("/shares/access", json={"code": "XXX-999"}, headers=auth_header(setup["doctor_token"]))
    assert resp.status_code == 404


# ---------- UC-P4: PDF ----------

def test_pdf_dokumentu(client, setup):
    s = setup
    doc_id = make_visit_with_prescription(client, s)

    resp = client.get(f"/documents/{doc_id}/pdf", headers=auth_header(s["patient_token"]))
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/pdf")
    assert resp.content[:5] == b"%PDF-"


def test_pdf_rbac(client, setup, factory):
    s = setup
    doc_id = make_visit_with_prescription(client, s)
    _, other_patient_token = factory.patient()
    assert client.get(f"/documents/{doc_id}/pdf", headers=auth_header(other_patient_token)).status_code == 403
    # personel może
    assert client.get(f"/documents/{doc_id}/pdf", headers=auth_header(s["doctor_token"])).status_code == 200


# ---------- UC-P7: przypomnienia ----------

def test_przypomnienia_24h(client, setup, db_session):
    s = setup
    # wizyta za ~20h (w oknie) i druga za 3 dni (poza oknem)
    near = (datetime.now() + timedelta(hours=20)).replace(minute=0, second=0, microsecond=0)
    far = (datetime.now() + timedelta(days=3)).replace(minute=0, second=0, microsecond=0)
    for dt in (near, far):
        slot = client.post(
            f"/clinics/{s['clinic'].clinic_id}/slots",
            json={"doctor_id": str(s["doctor"].user_id), "datetimes": [dt.isoformat()]},
            headers=auth_header(s["reg_token"]),
        ).json()[0]
        client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(s["patient_token"]))

    sent = send_due_reminders(db_session)
    assert sent == 1  # tylko wizyta w oknie 24h

    notifs = client.get("/notifications/my", headers=auth_header(s["patient_token"])).json()
    assert any(n["notification_title"] == "Przypomnienie o wizycie" for n in notifs)

    # idempotencja — drugi przebieg nic nie wysyła
    assert send_due_reminders(db_session) == 0
