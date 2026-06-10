import io
from datetime import datetime, timedelta

import pytest
from starlette.testclient import WebSocketDisconnect

from tests.conftest import auth_header, make_token


@pytest.fixture()
def online_visit(client, factory):
    """Potwierdzona wizyta ONLINE: klinika + lekarz + pacjent."""
    _, reg_token = factory.user("rejestracja")
    doctor_user, doctor_token = factory.doctor()
    patient_user, patient_token = factory.patient()
    clinic = factory.clinic()
    factory.employ(clinic, doctor_user.user_id)

    dt = (datetime.now() + timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0)
    slot = client.post(
        f"/clinics/{clinic.clinic_id}/slots",
        json={"doctor_id": doctor_user.user_id, "datetimes": [dt.isoformat()], "appointment_type": "ONLINE"},
        headers=auth_header(reg_token),
    ).json()[0]
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(patient_token))
    return {
        "appointment_id": slot["appointment_id"],
        "doctor": doctor_user, "doctor_token": doctor_token,
        "patient": patient_user, "patient_token": patient_token,
    }


def ws_url(visit, token):
    return f"/ws/telemed/{visit['appointment_id']}?token={token}"


def test_ws_relay_czatu_i_sygnalizacji(client, online_visit):
    v = online_visit
    with client.websocket_connect(ws_url(v, v["doctor_token"])) as doctor_ws:
        with client.websocket_connect(ws_url(v, v["patient_token"])) as patient_ws:
            # lekarz dostaje informację o dołączeniu pacjenta
            joined = doctor_ws.receive_json()
            assert joined == {"type": "peer-joined", "role": "patient"}

            # czat: pacjent → lekarz (z dopisaną rolą nadawcy)
            patient_ws.send_json({"type": "chat", "text": "Dzień dobry, doktorze"})
            msg = doctor_ws.receive_json()
            assert msg["type"] == "chat"
            assert msg["text"] == "Dzień dobry, doktorze"
            assert msg["sender_role"] == "patient"

            # sygnalizacja WebRTC: lekarz → pacjent
            doctor_ws.send_json({"type": "webrtc-offer", "sdp": "fake-sdp"})
            offer = patient_ws.receive_json()
            assert offer["type"] == "webrtc-offer"
            assert offer["sender_role"] == "doctor"

        # po wyjściu pacjenta lekarz dostaje peer-left
        left = doctor_ws.receive_json()
        assert left == {"type": "peer-left", "role": "patient"}


def test_ws_obcy_uzytkownik_odrzucony(client, online_visit, factory):
    _, stranger_token = factory.patient()
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(ws_url(online_visit, stranger_token)) as ws:
            ws.receive_json()
    assert exc.value.code == 4403


def test_ws_zly_token_odrzucony(client, online_visit):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(ws_url(online_visit, make_token(secret="zly-sekret-zly-sekret-zly-sekret"))) as ws:
            ws.receive_json()
    assert exc.value.code == 4401


def test_ws_wizyta_stacjonarna_odrzucona(client, factory):
    _, reg_token = factory.user("rejestracja")
    doctor_user, doctor_token = factory.doctor()
    patient_user, patient_token = factory.patient()
    clinic = factory.clinic()
    factory.employ(clinic, doctor_user.user_id)
    dt = (datetime.now() + timedelta(days=1)).replace(hour=12, minute=0, second=0, microsecond=0)
    slot = client.post(
        f"/clinics/{clinic.clinic_id}/slots",
        json={"doctor_id": doctor_user.user_id, "datetimes": [dt.isoformat()], "appointment_type": "STATIONARY"},
        headers=auth_header(reg_token),
    ).json()[0]
    client.post(f"/appointments/{slot['appointment_id']}/book", headers=auth_header(patient_token))

    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/ws/telemed/{slot['appointment_id']}?token={patient_token}") as ws:
            ws.receive_json()
    assert exc.value.code == 4409


def test_zalaczniki_upload_download_rbac(client, online_visit, factory):
    v = online_visit
    content = b"fake-jpeg-bytes" * 100

    resp = client.post(
        f"/telemed/{v['appointment_id']}/attachments",
        files={"file": ("wynik badania.jpg", io.BytesIO(content), "image/jpeg")},
        headers=auth_header(v["patient_token"]),
    )
    assert resp.status_code == 201, resp.text
    att = resp.json()
    assert att["original_name"] == "wynik badania.jpg"
    assert att["size"] == len(content)

    # lekarz (uczestnik) pobiera
    resp = client.get(att["url"], headers=auth_header(v["doctor_token"]))
    assert resp.status_code == 200
    assert resp.content == content

    # obcy pacjent nie pobierze
    _, stranger_token = factory.patient()
    assert client.get(att["url"], headers=auth_header(stranger_token)).status_code == 403
