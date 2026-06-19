# Bezpieczny reset danych testowych NovaMed.
#
# Czyści WYŁĄCZNIE dane transakcyjne (wizyty, dokumenty, noty, płatności,
# udostępnienia, opinie, zabiegi, powiadomienia, audyt, lista oczekujących)
# oraz konta utworzone przez testy/aplikację (goście, podopieczni) — czyli
# wszystko spoza kanonicznych kont z provision-users.
#
# ZACHOWUJE: role, kanoniczne konta (app_user) + profile (doctor/nurse/admin/
# patient), placówki, przypisania personelu/pacjentów do placówek (staff_clinic,
# patient_clinic), słowniki ICD-10/leków, stan migracji (alembic_version).
#
# Po resecie dane domenowe tworzy się normalnie przez aplikację (albo smoke).
# Sensowne, gdy dev-baza nasyci się artefaktami wielu biegów (kolizje slotów).
#
# Użycie:  cd backend; .venv\Scripts\python.exe ..\scripts\reset-test-data.py
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import text  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402

# Kanoniczne konta (muszą się zgadzać z USERS w provision-users.py).
SEED_EMAILS = [
    "admin@novamed.dev",
    "a.kowalczyk@novamed.dev", "p.zielinski@novamed.dev", "m.sawicka@novamed.dev",
    "k.lis@novamed.dev", "rejestracja@novamed.dev", "kierownik@novamed.dev",
    "janina.wisniewska@novamed.dev", "tomasz.borkowski@novamed.dev",
]

# Dane transakcyjne — TRUNCATE … CASCADE ogarnia kolejność kluczy obcych.
TRANSACTIONAL = [
    "appointment", "clinical_note", "note_addendum", "note_event", "medical_document",
    "prescription", "referral", "lab_result", "sick_leave", "certificate", "payment",
    "review", "nursing_procedure", "notification", "audit_log", "document_share",
    "waiting_list",
    # katalog usług / typy wizyt + weryfikacje OTP
    "service", "doctor_service", "phone_verification",
]


def main() -> None:
    db = SessionLocal()
    try:
        # 1) dane transakcyjne
        db.execute(text(
            "TRUNCATE TABLE " + ", ".join(f'"{t}"' for t in TRANSACTIONAL)
            + " RESTART IDENTITY CASCADE"
        ))
        db.commit()
        print("Wyczyszczono dane transakcyjne:")
        print("  " + ", ".join(TRANSACTIONAL))

        # 2) konta spoza seedu (goście / podopieczni z testów)
        extra = db.execute(
            text("SELECT user_id::text, email FROM app_user WHERE lower(email) <> ALL(:seed)"),
            {"seed": SEED_EMAILS},
        ).all()
        ids = [u for u, _ in extra]
        if ids:
            db.execute(text("DELETE FROM patient_clinic WHERE patient_id = ANY(:ids)"), {"ids": ids})
            db.execute(text("DELETE FROM patient WHERE patient_id = ANY(:ids)"), {"ids": ids})
            db.execute(text("DELETE FROM app_user WHERE user_id = ANY(:ids)"), {"ids": ids})
            db.commit()
            print(f"Usunięto {len(ids)} kont spoza seedu: {[e for _, e in extra]}")
        else:
            print("Brak kont spoza seedu.")

        kept = db.execute(text("SELECT count(*) FROM app_user")).scalar()
        print(f"\nGotowe. Kanonicznych kont: {kept}. Uruchom provision-users (idempotentny),")
        print("by upewnić się co do przypisań placówek, a dane domenowe twórz przez aplikację/smoke.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
