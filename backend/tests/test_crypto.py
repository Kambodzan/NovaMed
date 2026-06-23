# Szyfrowanie danych wrażliwych at-rest (AES-256-GCM) + blind index PESEL (HMAC).
# Kluczowy dowód „at rest": surowy odczyt kolumny (text(), z pominięciem TypeDecorator)
# zwraca SZYFROGRAM, nie tekst jawny.
import uuid
from datetime import date, datetime

import pytest
from cryptography.exceptions import InvalidTag
from sqlalchemy import select, text

from app.core import crypto
from app.models import AppUser, ClinicalNote, MedicalDocument, Patient, Role


def test_encrypt_decrypt_roundtrip():
    plain = "Rozpoznanie: I10. Zalecenia: kontrola za 4 tygodnie. ąęś"
    token = crypto.encrypt(plain)
    assert token.startswith("enc:v1:")
    assert plain not in token  # tekst jawny nie wycieka do szyfrogramu
    assert crypto.decrypt(token) == plain
    # losowy nonce → dwa szyfrowania tej samej treści różnią się
    assert crypto.encrypt(plain) != crypto.encrypt(plain)


def test_decrypt_legacy_plaintext_tolerowany():
    # wartość bez markera (sprzed włączenia szyfrowania) czytamy jak jest
    assert crypto.decrypt("47030812344") == "47030812344"


def test_tamper_wykryty():
    token = crypto.encrypt("tajne")
    body = token[len("enc:v1:"):]
    tampered = "enc:v1:" + ("A" + body[1:] if body[0] != "A" else "B" + body[1:])
    with pytest.raises((InvalidTag, ValueError)):
        crypto.decrypt(tampered)


def test_blind_index_deterministyczny():
    assert crypto.blind_index("47030812344") == crypto.blind_index("47030812344")
    assert crypto.blind_index("47030812344") != crypto.blind_index("90010112345")
    assert crypto.blind_index(" 47030812344 ") == crypto.blind_index("47030812344")  # normalizacja (strip)


def _patient(db, pesel="47030812344", **kw):
    uid = uuid.uuid4()
    role = db.scalar(select(Role).where(Role.role_name == "pacjent"))
    db.add(AppUser(user_id=uid, supabase_uid=uid, role_id=role.role_id,
                   username=f"p-{uid.hex[:6]}", email=f"{uid.hex[:8]}@t.pl", active_account=True))
    p = Patient(patient_id=uid, first_name="Jan", last_name="Test", pesel=pesel,
                birth_date=date(1947, 3, 8), **kw)
    db.add(p)
    db.commit()
    return p


def test_pesel_szyfrowany_at_rest_plus_blind_index(db_session):
    p = _patient(db_session, pesel="47030812344", allergies="Penicylina")
    # ORM odczytuje jawnie
    assert p.pesel == "47030812344"
    assert p.allergies == "Penicylina"
    # surowy odczyt kolumny (bez TypeDecorator) = szyfrogram, nie PESEL
    raw = db_session.execute(  # świeży db_session = jeden pacjent
        text("SELECT pesel, pesel_bidx, allergies FROM patient")
    ).first()
    assert raw[0].startswith("enc:v1:") and "47030812344" not in raw[0]
    assert raw[1] == crypto.blind_index("47030812344")  # bidx = HMAC, nie PESEL
    assert raw[2].startswith("enc:v1:") and "Penicylina" not in raw[2]


def test_lookup_po_pesel_idzie_przez_bidx(db_session):
    _patient(db_session, pesel="88112233445")
    found = db_session.scalar(
        select(Patient).where(Patient.pesel_bidx == crypto.blind_index("88112233445")))
    assert found is not None and found.pesel == "88112233445"


def test_dokument_i_nota_szyfrowane_at_rest(db_session):
    p = _patient(db_session, pesel="61050511111")
    doc = MedicalDocument(patient_id=p.patient_id, issued_at=datetime.now(),
                          document_type="NOTE", document_content="Pacjent zgłasza ból głowy.",
                          document_status="FINAL")
    db_session.add(doc)
    db_session.commit()
    raw = db_session.execute(text("SELECT document_content FROM medical_document")).scalar()
    assert raw.startswith("enc:v1:") and "ból głowy" not in raw
    assert doc.document_content == "Pacjent zgłasza ból głowy."  # ORM odszyfrowuje
