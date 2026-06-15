# Izolacja między placówkami (multi-tenant).
# Zasada: personel domyślnie widzi tylko pacjentów SWOICH placówek. Pacjent „należy"
# do placówki, w której ma wizyty (Appointment.clinic_id) lub jawne przypisanie
# (PatientClinic). Dostęp międzyplacówkowy jest możliwy WYŁĄCZNIE przez kod
# udostępnienia od pacjenta (UC-P6, /shares/access) — świadoma zgoda pacjenta.
#
# Bezpieczny domyślny przypadek: pacjent bez żadnego śladu (świeżo zarejestrowany,
# bez wizyt) jest dostępny dla każdego personelu — inaczej rejestracja nie mogłaby
# obsłużyć nowo założonej kartoteki. Admin ma dostęp pełny; kierownik — do swoich placówek.
from datetime import date
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import Appointment, AppUser, PatientClinic, StaffClinic

ADMIN_ROLE = "administrator"


def staff_clinic_ids(db: Session, user: AppUser) -> set[UUID]:
    """Placówki, w których personel jest aktualnie zatrudniony (end_date pusty lub przyszły)."""
    today = date.today()
    rows = db.scalars(
        select(StaffClinic.clinic_id).where(
            StaffClinic.user_id == user.user_id,
            or_(StaffClinic.end_date.is_(None), StaffClinic.end_date >= today),
        )
    )
    return set(rows)


def patient_clinic_ids(db: Session, patient_id: UUID) -> set[UUID]:
    """Placówki, z którymi pacjent jest powiązany: wizyty + jawne przypisania."""
    pc = db.scalars(select(PatientClinic.clinic_id).where(PatientClinic.patient_id == patient_id))
    ap = db.scalars(select(Appointment.clinic_id).where(Appointment.patient_id == patient_id))
    return set(pc) | set(ap)


def staff_can_access_patient(db: Session, user: AppUser, patient_id: UUID) -> bool:
    if user.role.role_name == ADMIN_ROLE:
        return True
    footprint = patient_clinic_ids(db, patient_id)
    if not footprint:  # brak śladu (np. świeżo zarejestrowany) — dostępny
        return True
    return bool(footprint & staff_clinic_ids(db, user))


def assert_staff_can_access_patient(db: Session, user: AppUser, patient_id: UUID) -> None:
    """Personel poza swoją placówką → 403 (z podpowiedzią o kodzie udostępnienia)."""
    if not staff_can_access_patient(db, user, patient_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Pacjent nie jest przypisany do Twojej placówki. Aby zobaczyć jego "
                   "dokumentację, poproś pacjenta o kod udostępnienia.",
        )


def assert_staff_in_clinic(db: Session, user: AppUser, clinic_id: UUID) -> None:
    """Operacje na danych konkretnej placówki (lista pacjentów, raporty, kalendarz)."""
    if user.role.role_name == ADMIN_ROLE:
        return
    if clinic_id not in staff_clinic_ids(db, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Brak dostępu do tej placówki.",
        )
