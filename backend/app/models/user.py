# Użytkownicy i podtypy ról — zgodnie ze schematem danych.
# Podtypy (administrator/doctor/nurse/patient): PK = FK do app_user.user_id.
import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.ext.associationproxy import association_proxy
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.core.crypto import Encrypted, blind_index
from app.core.db import Base


class Role(Base):
    __tablename__ = "role"

    role_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    role_name: Mapped[str] = mapped_column(String(50))
    role_description: Mapped[str | None] = mapped_column(String(255))

    users: Mapped[list["AppUser"]] = relationship(back_populates="role")


class AppUser(Base):
    __tablename__ = "app_user"

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("role.role_id"))
    # Tożsamość w Supabase Auth (claim `sub` tokenu JWT)
    supabase_uid: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True)
    username: Mapped[str] = mapped_column(String(50))
    # Nieużywane — hasła trzyma Supabase; kolumna zostaje dla zgodności z ERD
    hashed_password: Mapped[str | None] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(100))
    phone_number: Mapped[str | None] = mapped_column(String(20))
    active_account: Mapped[bool] = mapped_column(Boolean, default=False)
    # preferencja kanału SMS (in-app zawsze; push dojdzie w M9)
    notify_sms: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    role: Mapped["Role"] = relationship(back_populates="users")


class Administrator(Base):
    __tablename__ = "administrator"

    administrator_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.user_id"), primary_key=True)
    is_system_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_clinic_admin: Mapped[bool] = mapped_column(Boolean, default=False)

    user: Mapped["AppUser"] = relationship()


class Doctor(Base):
    __tablename__ = "doctor"

    doctor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.user_id"), primary_key=True)
    license_number: Mapped[str] = mapped_column(String(50))
    academic_title: Mapped[str | None] = mapped_column(String(100))

    user: Mapped["AppUser"] = relationship()
    # lekarz może mieć wiele specjalizacji (np. internista + kardiolog)
    specializations: Mapped[list["DoctorSpecialization"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin", order_by="DoctorSpecialization.name")
    specialization_names = association_proxy("specializations", "name")


class DoctorSpecialization(Base):
    """Pojedyncza specjalizacja lekarza (relacja 1:N do Doctor)."""

    __tablename__ = "doctor_specialization"
    __table_args__ = (UniqueConstraint("doctor_id", "name", name="uq_doctor_specialization"),)

    doctor_specialization_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    doctor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("doctor.doctor_id"))
    name: Mapped[str] = mapped_column(String(100))


class Nurse(Base):
    __tablename__ = "nurse"

    nurse_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.user_id"), primary_key=True)
    license_number: Mapped[str] = mapped_column(String(50))
    specialization: Mapped[str | None] = mapped_column(String(100))

    user: Mapped["AppUser"] = relationship()


class Patient(Base):
    __tablename__ = "patient"

    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.user_id"), primary_key=True)
    first_name: Mapped[str] = mapped_column(String(50))
    last_name: Mapped[str] = mapped_column(String(50))
    # PESEL szyfrowany at-rest (AES-256-GCM); wyszukiwanie równościowe idzie po blind
    # index `pesel_bidx` = HMAC(PESEL), utrzymywanym automatycznie przez @validates.
    pesel: Mapped[str] = mapped_column(Encrypted)
    pesel_bidx: Mapped[str | None] = mapped_column(String(64), index=True)
    birth_date: Mapped[date] = mapped_column(Date)
    insurance_status: Mapped[bool] = mapped_column(Boolean, default=False)  # aktualizowane z eWUŚ
    # Dane kliniczne istotne przy wystawianiu recept (bezpieczeństwo pacjenta) —
    # prowadzi lekarz; alergie pokazują się banerem nad każdą receptą. Szyfrowane at-rest.
    allergies: Mapped[str | None] = mapped_column(Encrypted)
    chronic_diseases: Mapped[str | None] = mapped_column(Encrypted)
    chronic_medications: Mapped[str | None] = mapped_column(Encrypted)

    @validates("pesel")
    def _sync_pesel_bidx(self, _key: str, value: str | None) -> str | None:
        # blind index liczony z JAWNEGO PESEL-u (przed zaszyfrowaniem kolumny)
        self.pesel_bidx = blind_index(value) if value else None
        return value
    # Konta rodzinne (rozszerzenie ERD): opiekun zarządza
    # wizytami i dokumentacją podopiecznego; podopieczny nie loguje się sam.
    guardian_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("app_user.user_id"))

    user: Mapped["AppUser"] = relationship(foreign_keys=[patient_id])
    guardian: Mapped["AppUser | None"] = relationship(foreign_keys=[guardian_id])
