# „Powiadom o wcześniejszym terminie" — pacjent z notify_earlier dostaje
# powiadomienie, gdy u jego lekarza zwolni się termin wcześniejszy niż jego wizyta,
# ale nie bliższy niż clinic.earlier_notice_min_hours.
from datetime import datetime, timedelta

import pytest

from tests.conftest import auth_header


@pytest.fixture()
def setup(client, factory):
    _, reg_token = factory.user("rejestracja")
    _, admin_token = factory.user("administrator")
    doctor_user, doctor_token = factory.doctor()
    patient_user, patient_token = factory.patient()
    clinic = factory.clinic()
    factory.employ(clinic, doctor_user.user_id)
    return {
        "clinic": clinic, "doctor": doctor_user, "doctor_token": doctor_token,
        "patient": patient_user, "patient_token": patient_token,
        "reg_token": reg_token, "admin_token": admin_token,
    }


def make_slot(client, s, days_ahead=3, hour=10):
    dt = (datetime.now() + timedelta(days=days_ahead)).replace(hour=hour, minute=0, second=0, microsecond=0)
    return client.post(
        f"/clinics/{s['clinic'].clinic_id}/slots",
        json={"doctor_id": str(s["doctor"].user_id), "datetimes": [dt.isoformat()]},
        headers=auth_header(s["reg_token"]),
    ).json()[0]


def earlier_notices(client, token):
    notes = client.get("/notifications/my", headers=auth_header(token)).json()
    return [n for n in notes if "wcześniejszy termin" in n["notification_title"]]


def book_watching(client, s, slot):
    resp = client.post(
        f"/appointments/{slot['appointment_id']}/book",
        json={"notify_earlier": True},
        headers=auth_header(s["patient_token"]),
    )
    assert resp.status_code == 200
    return resp.json()["appointment"]


def test_anulowanie_powiadamia_obserwujacego(client, setup, factory):
    # wcześniejszy termin (za 5 dni) zajmuje inny pacjent ZANIM obserwator się zapisze,
    # żeby jedynym źródłem powiadomienia było odwołanie
    _, other_token = factory.patient()
    early = make_slot(client, setup, days_ahead=5)
    client.post(f"/appointments/{early['appointment_id']}/book", headers=auth_header(other_token))

    my_slot = make_slot(client, setup, days_ahead=10)
    book_watching(client, setup, my_slot)
    assert earlier_notices(client, setup["patient_token"]) == []

    client.post(f"/appointments/{early['appointment_id']}/cancel", headers=auth_header(other_token))

    notes = earlier_notices(client, setup["patient_token"])
    assert len(notes) == 1
    assert "Zwolnił się wcześniejszy termin" in notes[0]["notification_title"]


def test_nowy_slot_powiadamia_obserwujacego(client, setup):
    my_slot = make_slot(client, setup, days_ahead=10)
    book_watching(client, setup, my_slot)

    make_slot(client, setup, days_ahead=4, hour=9)
    assert len(earlier_notices(client, setup["patient_token"])) == 1


def test_brak_powiadomienia_gdy_slot_pozniejszy(client, setup):
    my_slot = make_slot(client, setup, days_ahead=4)
    book_watching(client, setup, my_slot)

    make_slot(client, setup, days_ahead=12)  # późniejszy niż wizyta obserwatora
    assert earlier_notices(client, setup["patient_token"]) == []


def test_brak_powiadomienia_bez_zgody(client, setup):
    my_slot = make_slot(client, setup, days_ahead=10)
    resp = client.post(f"/appointments/{my_slot['appointment_id']}/book", headers=auth_header(setup["patient_token"]))
    assert resp.json()["appointment"]["notify_earlier"] is False

    make_slot(client, setup, days_ahead=4)
    assert earlier_notices(client, setup["patient_token"]) == []


def test_limit_wyprzedzenia_placowki(client, setup):
    # placówka: nie powiadamiaj o terminach bliższych niż 240 h (10 dni)
    resp = client.patch(
        f"/clinics/{setup['clinic'].clinic_id}/settings",
        json={"earlier_notice_min_hours": 240},
        headers=auth_header(setup["admin_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["earlier_notice_min_hours"] == 240

    my_slot = make_slot(client, setup, days_ahead=20)
    book_watching(client, setup, my_slot)

    make_slot(client, setup, days_ahead=5)  # wcześniejszy, ale poniżej limitu 240 h
    assert earlier_notices(client, setup["patient_token"]) == []

    make_slot(client, setup, days_ahead=15)  # powyżej limitu → powiadomienie
    assert len(earlier_notices(client, setup["patient_token"])) == 1


def test_ustawienia_placowki_rbac_i_walidacja(client, setup):
    url = f"/clinics/{setup['clinic'].clinic_id}/settings"
    # ustawienia placówki: pacjent ANI rejestracja nie mogą (polityka = kierownik/admin)
    assert client.patch(url, json={"earlier_notice_min_hours": 48},
                        headers=auth_header(setup["patient_token"])).status_code == 403
    assert client.patch(url, json={"earlier_notice_min_hours": 48},
                        headers=auth_header(setup["reg_token"])).status_code == 403
    # admin: zła wartość → 422 (walidacja)
    assert client.patch(url, json={"earlier_notice_min_hours": 9999},
                        headers=auth_header(setup["admin_token"])).status_code == 422
    # wartość ustawiona przez admina widoczna na liście placówek
    client.patch(url, json={"earlier_notice_min_hours": 48}, headers=auth_header(setup["admin_token"]))
    clinics = client.get("/clinics", headers=auth_header(setup["patient_token"])).json()
    me = next(c for c in clinics if c["clinic_id"] == str(setup["clinic"].clinic_id))
    assert me["earlier_notice_min_hours"] == 48
