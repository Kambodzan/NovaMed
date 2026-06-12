# Provisioning kont testowych NovaMed (zamiast seedu demo) — produkcyjny przepływ.
#
# Dwa tryby (wykrywane z backend/.env):
#   1. SUPABASE skonfigurowane (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY):
#      konta zakładane w Supabase Auth przez Admin API (potwierdzone, z hasłem),
#      a app_user mapowany na PRAWDZIWE uid z Supabase.
#   2. Brak konfiguracji: tryb dev — uid = uuid5(email), logowanie przez
#      /auth/dev-token (hasło dowolne).
#
# Idempotentny: ponowne uruchomienie nic nie psuje; po włączeniu Supabase
# ponowny bieg PODMIENIA supabase_uid istniejących kont na realne uid
# (historia wizyt/dokumentów zostaje — to ten sam app_user).
#
# Użycie:  cd backend; .venv\Scripts\python.exe ..\scripts\provision-users.py
import sys
import uuid
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import httpx  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.db import SessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    Administrator, AppUser, Clinic, Doctor, Nurse, Patient, PatientClinic, Role, StaffClinic,
)

TEST_PASSWORD = "NovaMed.Test1"  # wspólne hasło kont testowych (tryb Supabase)

# Jedna przychodnia = wiele placówek; personel może pracować w kilku naraz.
CLINICS = [
    {
        "clinic_name": "Zdrowa Rodzina — Piastów",
        "address": "ul. Słowackiego 12, 05-820 Piastów",
        "city": "Piastów",
        "phone": "22 723 45 67",
        "clinic_email": "piastow@zdrowarodzina.pl",
    },
    {
        "clinic_name": "Zdrowa Rodzina — Ursus",
        "address": "ul. Traktorzystów 4, 02-495 Warszawa",
        "city": "Warszawa",
        "phone": "22 478 12 00",
        "clinic_email": "ursus@zdrowarodzina.pl",
    },
]

# (email, imię i nazwisko, rola, extra)
USERS = [
    ("admin@novamed.dev", "Administrator Systemu", "administrator", {}),
    ("a.kowalczyk@novamed.dev", "dr Anna Kowalczyk", "lekarz",
     {"specialization": "Kardiolog", "academic_title": "dr n. med.", "license": "1234567"}),
    ("p.zielinski@novamed.dev", "dr Piotr Zieliński", "lekarz",
     {"specialization": "Internista", "academic_title": "lek.", "license": "2345678"}),
    ("m.sawicka@novamed.dev", "dr Magdalena Sawicka", "lekarz",
     {"specialization": "Endokrynolog", "academic_title": "dr n. med.", "license": "3456789"}),
    ("k.lis@novamed.dev", "piel. Katarzyna Lis", "pielegniarka", {"license": "7654321"}),
    ("rejestracja@novamed.dev", "Barbara Krawczyk", "rejestracja", {}),
    ("janina.wisniewska@novamed.dev", "Janina Wiśniewska", "pacjent",
     {"first_name": "Janina", "last_name": "Wiśniewska", "pesel_base": "4703081234",
      "birth_date": date(1947, 3, 8), "phone": "601234567"}),
    ("tomasz.borkowski@novamed.dev", "Tomasz Borkowski", "pacjent",
     {"first_name": "Tomasz", "last_name": "Borkowski", "pesel_base": "8511223456",
      "birth_date": date(1985, 11, 22), "phone": "602345678"}),
]

PESEL_WEIGHTS = (1, 3, 7, 9, 1, 3, 7, 9, 1, 3)


def pesel_full(base10: str) -> str:
    checksum = (10 - sum(int(d) * w for d, w in zip(base10, PESEL_WEIGHTS)) % 10) % 10
    return base10 + str(checksum)


def supabase_configured() -> bool:
    return bool(settings.supabase_url and settings.supabase_service_role_key)


def supabase_uids_by_email() -> dict[str, str]:
    """Mapa email -> uid istniejących użytkowników w Supabase."""
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    resp = httpx.get(f"{settings.supabase_url}/auth/v1/admin/users",
                     params={"per_page": 1000}, headers=headers, timeout=30)
    resp.raise_for_status()
    return {u["email"].lower(): u["id"] for u in resp.json().get("users", []) if u.get("email")}


def supabase_create_user(email: str, full_name: str) -> str:
    """Tworzy potwierdzone konto w Supabase, zwraca uid."""
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    resp = httpx.post(
        f"{settings.supabase_url}/auth/v1/admin/users",
        headers=headers, timeout=30,
        json={
            "email": email,
            "password": TEST_PASSWORD,
            "email_confirm": True,
            "user_metadata": {"full_name": full_name},
        },
    )
    resp.raise_for_status()
    return resp.json()["id"]


def main() -> None:
    use_supabase = supabase_configured()
    if use_supabase:
        print(f"Tryb SUPABASE ({settings.supabase_url}) — konta z haslem '{TEST_PASSWORD}'.")
        existing_sb = supabase_uids_by_email()
    else:
        print("Tryb DEV (brak SUPABASE_URL/SERVICE_ROLE_KEY) — logowanie przez /auth/dev-token, haslo dowolne.")
        existing_sb = {}

    db = SessionLocal()
    try:
        # migracja nazwy z czasów jednej placówki
        legacy = db.scalar(select(Clinic).where(Clinic.clinic_name == "Przychodnia „Zdrowa Rodzina”"))
        if legacy:
            legacy.clinic_name = CLINICS[0]["clinic_name"]
            legacy.clinic_email = CLINICS[0]["clinic_email"]
        clinics = []
        for spec in CLINICS:
            c = db.scalar(select(Clinic).where(Clinic.clinic_name == spec["clinic_name"]))
            if c is None:
                c = Clinic(**spec)
                db.add(c)
                db.flush()
                print(f"+ placowka: {c.clinic_name}")
            c.city = spec["city"]  # uzupełnij/odśwież miasto (idempotentnie)
            clinics.append(c)

        roles = {r.role_name: r.role_id for r in db.scalars(select(Role))}

        for email, full_name, role_name, extra in USERS:
            email = email.lower()
            if use_supabase:
                uid = existing_sb.get(email) or supabase_create_user(email, full_name)
            else:
                uid = str(uuid.uuid5(uuid.NAMESPACE_DNS, email))

            user = db.scalar(select(AppUser).where(AppUser.email == email))
            if user is None:
                user = AppUser(
                    role_id=roles[role_name], supabase_uid=uuid.UUID(uid),
                    username=full_name, email=email,
                    phone_number=extra.get("phone"), active_account=True,
                )
                db.add(user)
                db.flush()
                print(f"+ {role_name}: {email}")
            elif str(user.supabase_uid) != uid:
                user.supabase_uid = uuid.UUID(uid)  # przejście dev -> Supabase
                print(f"~ {email}: podmieniono uid na Supabase")

            if role_name == "lekarz" and db.get(Doctor, user.user_id) is None:
                db.add(Doctor(doctor_id=user.user_id, license_number=extra["license"],
                              specialization=extra["specialization"], academic_title=extra["academic_title"]))
            elif role_name == "pielegniarka" and db.get(Nurse, user.user_id) is None:
                db.add(Nurse(nurse_id=user.user_id, license_number=extra["license"]))
            elif role_name == "administrator" and db.get(Administrator, user.user_id) is None:
                db.add(Administrator(administrator_id=user.user_id, is_system_admin=True))
            elif role_name == "pacjent" and db.get(Patient, user.user_id) is None:
                db.add(Patient(
                    patient_id=user.user_id, first_name=extra["first_name"], last_name=extra["last_name"],
                    pesel=pesel_full(extra["pesel_base"]), birth_date=extra["birth_date"],
                ))

            # przypisania: personel i pacjenci do OBU placówek (lekarz raz tu, raz tam)
            for clinic in clinics:
                if role_name in ("lekarz", "pielegniarka", "rejestracja"):
                    if not db.scalar(select(StaffClinic).where(
                        StaffClinic.clinic_id == clinic.clinic_id, StaffClinic.user_id == user.user_id,
                    )):
                        db.add(StaffClinic(clinic_id=clinic.clinic_id, user_id=user.user_id, start_date=date.today()))
                elif role_name == "pacjent":
                    if not db.scalar(select(PatientClinic).where(
                        PatientClinic.clinic_id == clinic.clinic_id, PatientClinic.patient_id == user.user_id,
                    )):
                        db.add(PatientClinic(clinic_id=clinic.clinic_id, patient_id=user.user_id,
                                             assigned_date=date.today()))

        db.commit()
        print("\nKonta testowe gotowe:")
        for email, _name, role_name, _extra in USERS:
            print(f"  {role_name:<14} {email}")
        print(f"\nHaslo (tryb Supabase): {TEST_PASSWORD}   |   tryb dev: dowolne haslo.")
        if not use_supabase:
            print("Aby przejsc na Supabase: uzupelnij backend/.env (SUPABASE_URL, SUPABASE_JWT_SECRET,")
            print("SUPABASE_SERVICE_ROLE_KEY) i frontend/.env.development (VITE_SUPABASE_URL,")
            print("VITE_SUPABASE_ANON_KEY), po czym uruchom ten skrypt ponownie.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
