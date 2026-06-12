from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Clinic(Base):
    __tablename__ = "clinic"

    clinic_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    clinic_name: Mapped[str] = mapped_column(String(100))
    address: Mapped[str] = mapped_column(String(255))
    # miasto jako oś filtrowania (sieciówka: 3 placówki w Warszawie, 2 w Krakowie…)
    city: Mapped[str | None] = mapped_column(String(60))
    # współrzędne pinezki na mapie placówek (wybór lokalizacji przy umawianiu)
    lat: Mapped[float | None] = mapped_column()
    lng: Mapped[float | None] = mapped_column()
    phone: Mapped[str | None] = mapped_column(String(20))
    clinic_email: Mapped[str | None] = mapped_column(String(100))
    # Minimalne wyprzedzenie [h] powiadomień o wcześniejszym terminie
    # (rozszerzenie ERD): nie powiadamiamy o slotach „za 2h".
    earlier_notice_min_hours: Mapped[int] = mapped_column(Integer, default=24)
    # Siatka terminów [min] — godziny slotów muszą leżeć na wielokrotności
    # (np. 15 → :00/:15/:30/:45); konfigurowalne per placówka.
    slot_interval_min: Mapped[int] = mapped_column(Integer, default=15)


class PatientClinic(Base):
    """Przypisanie pacjenta do placówki."""

    __tablename__ = "patient_clinic"

    patient_clinic_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinic.clinic_id"))
    patient_id: Mapped[int] = mapped_column(ForeignKey("patient.patient_id"))
    assigned_date: Mapped[date] = mapped_column(Date)

    clinic: Mapped["Clinic"] = relationship()
    patient = relationship("Patient")


class StaffClinic(Base):
    """Zatrudnienie personelu (lekarz/pielęgniarka/rejestracja) w placówce."""

    __tablename__ = "staff_clinic"

    staff_clinic_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinic.clinic_id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("app_user.user_id"))
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)

    clinic: Mapped["Clinic"] = relationship()
    user = relationship("AppUser")
