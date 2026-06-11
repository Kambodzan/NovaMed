# Import słowników ICD-10 i leków do bazy NovaMed (plug-and-play, idempotentny upsert).
#
# Domyślnie ładuje startowe zestawy z data/dictionaries/ (ICD-10 + popularne leki PL).
# Można podać własne pliki — np. pełne oficjalne wykazy:
#   --icd10 sciezka.csv   CSV "code;name" (separator ; lub , — wykrywany automatycznie)
#   --meds  sciezka.csv   CSV "name;form;strength"
#   --rpl   sciezka.csv   oficjalny CSV Rejestru Produktów Leczniczych (rejestrymedyczne.ezdrowie.gov.pl)
#                         — kolumny mapowane po nagłówkach (Nazwa Produktu Leczniczego / Postać farmaceutyczna / Moc)
#
# Użycie:  cd backend; .venv\Scripts\python.exe ..\scripts\import-dictionaries.py [opcje]
import argparse
import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from sqlalchemy import select  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402
from app.models import Icd10Entry, MedicationEntry  # noqa: E402

STARTER_ICD10 = ROOT / "data" / "dictionaries" / "icd10.csv"
STARTER_MEDS = ROOT / "data" / "dictionaries" / "medications.csv"


def read_csv(path: Path) -> list[dict[str, str]]:
    raw = path.read_text(encoding="utf-8-sig")
    delimiter = ";" if raw.splitlines()[0].count(";") >= raw.splitlines()[0].count(",") else ","
    return list(csv.DictReader(raw.splitlines(), delimiter=delimiter))


def import_icd10(db, path: Path) -> int:
    count = 0
    for row in read_csv(path):
        code = (row.get("code") or row.get("Kod") or "").strip()
        name = (row.get("name") or row.get("Nazwa") or "").strip()
        if not code or not name:
            continue
        entry = db.get(Icd10Entry, code)
        if entry:
            entry.name = name[:255]
        else:
            db.add(Icd10Entry(code=code[:10], name=name[:255]))
        count += 1
    return count


def med_key_lookup(row: dict[str, str], *names: str) -> str:
    """Dopasowanie kolumny po fragmencie nagłówka (oficjalne CSV miewają różne warianty)."""
    for header, value in row.items():
        if header and any(n.lower() in header.lower() for n in names):
            return (value or "").strip()
    return ""


def import_medications(db, path: Path, rpl: bool = False) -> int:
    existing = {
        (m.name, m.form, m.strength)
        for m in db.scalars(select(MedicationEntry))
    }
    count = 0
    for row in read_csv(path):
        if rpl:
            name = med_key_lookup(row, "Nazwa Produktu")
            form = med_key_lookup(row, "Postać") or None
            strength = med_key_lookup(row, "Moc") or None
        else:
            name = (row.get("name") or "").strip()
            form = (row.get("form") or "").strip() or None
            strength = (row.get("strength") or "").strip() or None
        if not name:
            continue
        name, form, strength = name[:255], (form or None) and form[:100], (strength or None) and strength[:100]
        if (name, form, strength) in existing:
            continue
        db.add(MedicationEntry(name=name, form=form, strength=strength))
        existing.add((name, form, strength))
        count += 1
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description="Import słowników ICD-10 i leków")
    parser.add_argument("--icd10", type=Path, default=STARTER_ICD10, help="CSV code;name")
    parser.add_argument("--meds", type=Path, default=STARTER_MEDS, help="CSV name;form;strength")
    parser.add_argument("--rpl", type=Path, default=None, help="oficjalny CSV RPL (zamiast --meds)")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        n_icd = import_icd10(db, args.icd10)
        if args.rpl:
            n_med = import_medications(db, args.rpl, rpl=True)
        else:
            n_med = import_medications(db, args.meds)
        db.commit()
        print(f"OK: ICD-10 {n_icd} pozycji (upsert), leki +{n_med} nowych pozycji.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
