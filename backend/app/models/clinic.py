import uuid

from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Clinic(Base):
    __tablename__ = "clinic"

    clinic_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    clinic_name: Mapped[str] = mapped_column(String(100))
    address: Mapped[str] = mapped_column(String(255))
    # miasto jako oś filtrowania (sieciówka: 3 placówki w Warszawie, 2 w Krakowie…)
    city: Mapped[str | None] = mapped_column(String(60))
    # współrzędne pinezki na mapie placówek (wybór lokalizacji przy umawianiu)
    lat: Mapped[float | None] = mapped_column()
    lng: Mapped[float | None] = mapped_column()
    # zdjęcie budynku (dymek na mapie); URL — podmienialne na własne zdjęcia
    photo_url: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(20))
    clinic_email: Mapped[str | None] = mapped_column(String(100))
    # Minimalne wyprzedzenie [h] powiadomień o wcześniejszym terminie
    # (rozszerzenie ERD): nie powiadamiamy o slotach „za 2h".
    earlier_notice_min_hours: Mapped[int] = mapped_column(Integer, default=24)
    # Siatka terminów [min] — godziny slotów muszą leżeć na wielokrotności
    # (np. 15 → :00/:15/:30/:45); konfigurowalne per placówka.
    slot_interval_min: Mapped[int] = mapped_column(Integer, default=15)
    # Tryb przypomnień SMS/in-app o wizytach:
    #   NONE     – brak przypomnień,
    #   REMINDER – tylko przypomnienie 24h przed (bez potwierdzania),
    #   CONFIRM  – przypomnienie + prośba o potwierdzenie obecności.
    reminder_mode: Mapped[str] = mapped_column(String(10), default="REMINDER", server_default="REMINDER")
    # synchronizowane z reminder_mode (== CONFIRM); zostaje dla zgodności
    confirmation_required: Mapped[bool] = mapped_column(Boolean, default=False)
    confirmation_hours: Mapped[int] = mapped_column(Integer, default=48)


class PatientClinic(Base):
    """Przypisanie pacjenta do placówki."""

    __tablename__ = "patient_clinic"

    patient_clinic_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    clinic_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clinic.clinic_id"))
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patient.patient_id"))
    assigned_date: Mapped[date] = mapped_column(Date)

    clinic: Mapped["Clinic"] = relationship()
    patient = relationship("Patient")


class StaffClinic(Base):
    """Zatrudnienie personelu (lekarz/pielęgniarka/rejestracja) w placówce."""

    __tablename__ = "staff_clinic"

    staff_clinic_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    clinic_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clinic.clinic_id"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.user_id"))
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    room: Mapped[str | None] = mapped_column(String(20))  # gabinet lekarza w tej placówce

    clinic: Mapped["Clinic"] = relationship()
    user = relationship("AppUser")
