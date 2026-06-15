# RODO (NFR 8.2): dziennik dostępu do danych medycznych + prawo do bycia zapomnianym.
from tests.conftest import auth_header


def test_audit_log_dostepu(client, factory):
    _, admin = factory.user("administrator")
    doctor_user, doctor_token = factory.doctor()
    patient_user, _ = factory.patient()

    # lekarz ogląda dokumentację pacjenta → wpis audytu
    client.get(f"/patients/{patient_user.user_id}/documents", headers=auth_header(doctor_token))
    client.get(f"/patients/{patient_user.user_id}", headers=auth_header(doctor_token))

    audit = client.get("/admin/audit", headers=auth_header(admin)).json()
    actions = {e["action"] for e in audit}
    assert "VIEW_DOCUMENTS" in actions and "VIEW_RECORD" in actions
    entry = next(e for e in audit if e["action"] == "VIEW_DOCUMENTS")
    assert entry["actor_role"] == "lekarz" and entry["patient_name"] is not None

    # dziennik tylko dla admina
    assert client.get("/admin/audit", headers=auth_header(doctor_token)).status_code == 403


def test_pacjent_nie_loguje_wlasnego_dostepu(client, factory):
    _, admin = factory.user("administrator")
    patient_user, patient_token = factory.patient()
    client.get("/documents/my", headers=auth_header(patient_token))
    audit = client.get("/admin/audit", headers=auth_header(admin)).json()
    # własny wgląd pacjenta nie jest „dostępem osoby trzeciej" — nie zaśmieca dziennika
    assert all(e["actor_role"] != "pacjent" for e in audit)


def test_prawo_do_bycia_zapomnianym(client, factory):
    _, admin = factory.user("administrator")
    doctor_user, doctor_token = factory.doctor()
    patient_user, _ = factory.patient()

    r = client.post(f"/admin/patients/{patient_user.user_id}/anonymize", headers=auth_header(admin))
    assert r.status_code == 200

    info = client.get(f"/patients/{patient_user.user_id}", headers=auth_header(doctor_token)).json()
    assert info["last_name"] == "zanonimizowane" and info["pesel"] == "00000000000"

    audit = client.get("/admin/audit", headers=auth_header(admin)).json()
    assert any(e["action"] == "ANONYMIZE" for e in audit)

    # anonimizacja tylko dla admina
    assert client.post(f"/admin/patients/{patient_user.user_id}/anonymize",
                       headers=auth_header(doctor_token)).status_code == 403
