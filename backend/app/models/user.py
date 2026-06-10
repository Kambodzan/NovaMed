# Użytkownicy i podtypy ról — zgodnie ze schematem danych.
# Podtypy (administrator/doctor/nurse/patient): PK = FK do app_user.user_id.
import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Role(Base):
    __tablename__ = "role"

    role_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role_name: Mapped[str] = mapped_column(String(50))
    role_description: Mapped[str | None] = mapped_column(String(255))

    users: Mapped[list["AppUser"]] = relationship(back_populates="role")


class AppUser(Base):
    __tablename__ = "app_user"

    user_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role_id: Mapped[int] = mapped_column(ForeignKey("role.role_id"))
    # Tożsamość w Supabase Auth (claim `sub` tokenu JWT)
    supabase_uid: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True)
    username: Mapped[str] = mapped_column(String(50))
    # Nieużywane — hasła trzyma Supabase; kolumna zostaje dla zgodności z ERD
    hashed_password: Mapped[str | None] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(100))
    phone_number: Mapped[str | None] = mapped_column(String(20))
    active_account: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    role: Mapped["Role"] = relationship(back_populates="users")


class Administrator(Base):
    __tablename__ = "administrator"

    administrator_id: Mapped[int] = mapped_column(ForeignKey("app_user.user_id"), primary_key=True)
    is_system_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_clinic_admin: Mapped[bool] = mapped_column(Boolean, default=False)

    user: Mapped["AppUser"] = relationship()


class Doctor(Base):
    __tablename__ = "doctor"

    doctor_id: Mapped[int] = mapped_column(ForeignKey("app_user.user_id"), primary_key=True)
    license_number: Mapped[str] = mapped_column(String(50))
    specialization: Mapped[str | None] = mapped_column(String(100))
    academic_title: Mapped[str | None] = mapped_column(String(100))

    user: Mapped["AppUser"] = relationship()


class Nurse(Base):
    __tablename__ = "nurse"

    nurse_id: Mapped[int] = mapped_column(ForeignKey("app_user.user_id"), primary_key=True)
    license_number: Mapped[str] = mapped_column(String(50))
    specialization: Mapped[str | None] = mapped_column(String(100))

    user: Mapped["AppUser"] = relationship()


class Patient(Base):
    __tablename__ = "patient"

    patient_id: Mapped[int] = mapped_column(ForeignKey("app_user.user_id"), primary_key=True)
    first_name: Mapped[str] = mapped_column(String(50))
    last_name: Mapped[str] = mapped_column(String(50))
    pesel: Mapped[str] = mapped_column(String(11))
    birth_date: Mapped[date] = mapped_column(Date)
    insurance_status: Mapped[bool] = mapped_column(Boolean, default=False)  # aktualizowane z eWUŚ

    user: Mapped["AppUser"] = relationship()
