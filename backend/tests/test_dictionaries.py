# Słowniki ICD-10 i leków — podpowiedzi (typeahead) dla personelu.
import pytest

from app.models import Icd10Entry, MedicationEntry
from tests.conftest import auth_header


@pytest.fixture()
def dictionaries(db_session):
    db_session.add_all([
        Icd10Entry(code="I10", name="Nadciśnienie tętnicze samoistne (pierwotne)",
                   name_en="Essential (primary) hypertension"),
        Icd10Entry(code="I11.9", name="Choroba nadciśnieniowa z zajęciem serca"),
        Icd10Entry(code="J06.9", name="Ostre zakażenie górnych dróg oddechowych"),
        MedicationEntry(name="Atorvasterol", form="tabletki powlekane", strength="40 mg"),
        MedicationEntry(name="Atorvasterol", form="tabletki powlekane", strength="20 mg"),
        MedicationEntry(name="Apap", form="tabletki powlekane", strength="500 mg"),
    ])
    db_session.commit()


def test_icd10_po_kodzie_i_nazwie(client, factory, dictionaries):
    _, doctor_token = factory.doctor()

    by_code = client.get("/dictionaries/icd10?q=I1", headers=auth_header(doctor_token)).json()
    assert [r["code"] for r in by_code] == ["I10", "I11.9"]

    by_name = client.get("/dictionaries/icd10?q=zakażenie", headers=auth_header(doctor_token)).json()
    assert [r["code"] for r in by_name] == ["J06.9"]


def test_icd10_dwujezyczny(client, factory, dictionaries):
    _, doctor_token = factory.doctor()
    # wyszukiwanie działa po nazwie ANGIELSKIEJ; odpowiedź ma obie nazwy
    rows = client.get("/dictionaries/icd10?q=hypertension", headers=auth_header(doctor_token)).json()
    i10 = next(r for r in rows if r["code"] == "I10")
    assert i10["name"] == "Nadciśnienie tętnicze samoistne (pierwotne)"
    assert i10["name_en"] == "Essential (primary) hypertension"
    # kod bez nazwy EN zwraca name_en = null, nie wybucha
    by_code = client.get("/dictionaries/icd10?q=J06", headers=auth_header(doctor_token)).json()
    assert by_code[0]["name_en"] is None


def test_leki_typeahead(client, factory, dictionaries):
    _, doctor_token = factory.doctor()
    rows = client.get("/dictionaries/medications?q=ator", headers=auth_header(doctor_token)).json()
    assert len(rows) == 2
    assert all(r["name"] == "Atorvasterol" for r in rows)
    assert {r["strength"] for r in rows} == {"20 mg", "40 mg"}


def test_slowniki_tylko_dla_personelu(client, factory, dictionaries):
    _, patient_token = factory.patient()
    assert client.get("/dictionaries/icd10?q=I10", headers=auth_header(patient_token)).status_code == 403
    assert client.get("/dictionaries/medications?q=apap", headers=auth_header(patient_token)).status_code == 403
