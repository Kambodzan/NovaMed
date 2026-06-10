# Seed danych demo (dev). Uruchomienie:
#   .\.venv\Scripts\python.exe -m app.seed_dev
# Idempotentny — pomija istniejące konta (po e-mailu).
# Tożsamości: sub = uuid5(email) — zgodnie z /auth/dev-token, więc logowanie
# dev-owe trafia w te same konta.
import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import select

from app.core.db import SessionLocal
from app.domain.appointments import AppointmentStatus, AppointmentType
from app.models import (
    Appointment, AppUser, Clinic, Doctor, Nurse, Patient, Role, StaffClinic,
)

DOCTORS = [
    ("a.kowalczyk@novamed.dev", "dr n. med. Anna Kowalczyk", "Kardiolog", "dr n. med."),
    ("t.zielinski@novamed.dev", "lek. Tomasz Zieliński", "Internista", "lek."),
    ("m.nowicka@novamed.dev", "dr hab. n. med. Maria Nowicka", "Endokrynolog", "dr hab. n. med."),
]


def sub_for(email: str) -> uuid.UUID:
    return uuid.uuid5(uuid.NAMESPACE_DNS, email.lower())


def get_or_create_user(db, email: str, username: str, role_name: str) -> AppUser:
    user = db.scalar(select(AppUser).where(AppUser.email == email))
    if user:
        return user
    role = db.scalar(select(Role).where(Role.role_name == role_name))
    user = AppUser(
        supabase_uid=sub_for(email),
        role_id=role.role_id,
        username=username[:50],
        email=email,
        active_account=True,
    )
    db.add(user)
    db.flush()
    return user


def main() -> None:
    db = SessionLocal()

    clinic = db.scalar(select(Clinic).where(Clinic.clinic_name == "Przychodnia „Zdrowa Rodzina”"))
    if clinic is None:
        clinic = Clinic(
            clinic_name="Przychodnia „Zdrowa Rodzina”",
            address="ul. Słowackiego 12, 05-820 Piastów",
            phone="22 723 45 67",
            clinic_email="kontakt@zdrowarodzina.pl",
        )
        db.add(clinic)
        db.flush()

    # personel
    doctor_ids: list[int] = []
    for email, name, spec, title in DOCTORS:
        u = get_or_create_user(db, email, name, "lekarz")
        if db.get(Doctor, u.user_id) is None:
            db.add(Doctor(doctor_id=u.user_id, license_number="1234567", specialization=spec, academic_title=title))
        if not db.scalar(select(StaffClinic).where(StaffClinic.clinic_id == clinic.clinic_id, StaffClinic.user_id == u.user_id)):
            db.add(StaffClinic(clinic_id=clinic.clinic_id, user_id=u.user_id, start_date=date(2025, 1, 1)))
        doctor_ids.append(u.user_id)

    nurse_u = get_or_create_user(db, "k.lis@novamed.dev", "piel. Katarzyna Lis", "pielegniarka")
    if db.get(Nurse, nurse_u.user_id) is None:
        db.add(Nurse(nurse_id=nurse_u.user_id, license_number="7654321"))
    get_or_create_user(db, "rejestracja@novamed.dev", "Barbara Krawczyk", "rejestracja")
    get_or_create_user(db, "admin@novamed.dev", "Administrator", "administrator")

    # pacjentka demo
    pat_u = get_or_create_user(db, "janina.wisniewska@novamed.dev", "Janina Wiśniewska", "pacjent")
    if db.get(Patient, pat_u.user_id) is None:
        db.add(Patient(
            patient_id=pat_u.user_id, first_name="Janina", last_name="Wiśniewska",
            pesel="52041512345", birth_date=date(1952, 4, 15), insurance_status=True,
        ))

    # wolne sloty: najbliższe 7 dni, 4 sloty dziennie na lekarza
    existing_slots = db.scalar(
        select(Appointment.appointment_id).where(Appointment.appointment_status == AppointmentStatus.FREE.value).limit(1)
    )
    created_slots = 0
    if existing_slots is None:
        base = datetime.now().replace(minute=0, second=0, microsecond=0)
        for day in range(1, 8):
            for di, doctor_id in enumerate(doctor_ids):
                for hour in (8, 10, 12, 15):
                    db.add(Appointment(
                        patient_id=None,
                        doctor_id=doctor_id,
                        clinic_id=clinic.clinic_id,
                        appointment_datetime=base.replace(hour=hour) + timedelta(days=day, minutes=di * 20),
                        appointment_status=AppointmentStatus.FREE.value,
                        appointment_type=(AppointmentType.ONLINE if hour == 15 else AppointmentType.STATIONARY).value,
                    ))
                    created_slots += 1

    # jedna potwierdzona wizyta pacjentki (jutro 9:00 u Kowalczyk)
    has_visit = db.scalar(select(Appointment).where(Appointment.patient_id == pat_u.user_id).limit(1))
    if has_visit is None:
        db.add(Appointment(
            patient_id=pat_u.user_id,
            doctor_id=doctor_ids[0],
            clinic_id=clinic.clinic_id,
            appointment_datetime=(datetime.now() + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0),
            appointment_status=AppointmentStatus.CONFIRMED.value,
            appointment_type=AppointmentType.STATIONARY.value,
        ))

    db.commit()
    print(f"Seed OK — klinika #{clinic.clinic_id}, lekarze: {len(doctor_ids)}, nowe sloty: {created_slots}")
    db.close()


if __name__ == "__main__":
    main()
