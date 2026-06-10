import uuid

from tests.conftest import auth_header, make_token

PROFILE = {
    "first_name": "Janina",
    "last_name": "Wiśniewska",
    "pesel": "52041512345",
    "birth_date": "1952-04-15",
    "phone_number": "601234567",
}


def test_me_bez_tokenu_401(client):
    assert client.get("/auth/me").status_code == 401


def test_me_zly_podpis_401(client):
    token = make_token(secret="inny-sekret")
    assert client.get("/auth/me", headers=auth_header(token)).status_code == 401


def test_me_bez_profilu_403(client):
    token = make_token()
    resp = client.get("/auth/me", headers=auth_header(token))
    assert resp.status_code == 403


def test_rejestracja_profilu_i_me(client):
    sub = str(uuid.uuid4())
    token = make_token(sub=sub)

    resp = client.post("/auth/register-profile", json=PROFILE, headers=auth_header(token))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["role"] == "pacjent"
    assert body["email"] == "jan.testowy@example.com"

    resp = client.get("/auth/me", headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["role"] == "pacjent"


def test_podwojna_rejestracja_409(client):
    token = make_token()
    assert client.post("/auth/register-profile", json=PROFILE, headers=auth_header(token)).status_code == 201
    assert client.post("/auth/register-profile", json=PROFILE, headers=auth_header(token)).status_code == 409


def test_walidacja_pesel_422(client):
    token = make_token()
    bad = {**PROFILE, "pesel": "123"}
    assert client.post("/auth/register-profile", json=bad, headers=auth_header(token)).status_code == 422
