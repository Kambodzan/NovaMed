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


def test_profil_pacjenta_i_edycja(client, factory):
    """Pacjent widzi swój profil (dane + eWUŚ) i edytuje własne dane kontaktowe."""
    _, token = factory.patient()
    prof = client.get("/auth/me/profile", headers=auth_header(token))
    assert prof.status_code == 200, prof.text
    assert prof.json()["pesel"] and "insurance_status" in prof.json()

    r = client.patch("/auth/me/contact", json={"phone_number": "601 234 567", "first_name": "Zofia"},
                     headers=auth_header(token))
    assert r.status_code == 200
    assert r.json()["phone_number"] == "601 234 567" and r.json()["first_name"] == "Zofia"

    # personel nie korzysta z profilu pacjenta
    _, doc_token = factory.doctor()
    assert client.get("/auth/me/profile", headers=auth_header(doc_token)).status_code == 403
