import uuid

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Appointment(Base):
    """Wizyta. patient_id = NULL oznacza wolny termin (slot w kalendarzu).

    Statusy i przejścia: diagram stanów wizyty
    (FREE, TEMP_LOCK, CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED, NO_SHOW, INTERRUPTED).
    """

    __tablename__ = "appointment"

    appointment_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("patient.patient_id"))
    # NULL dla terminów BADAŃ — badanie wykonuje pracownia placówki, nie lekarz
    doctor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("doctor.doctor_id"))
    nurse_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("nurse.nurse_id"))
    clinic_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clinic.clinic_id"))
    appointment_datetime: Mapped[datetime] = mapped_column(DateTime)
    appointment_status: Mapped[str] = mapped_column(String(50))
    appointment_type: Mapped[str] = mapped_column(String(50))  # ONLINE / STATIONARY
    # Dla slotu STATIONARY: czy pacjent może wybrać teleporadę (wideo). False =
    # wyłącznie stacjonarnie (np. gabinet niedostosowany / wizyta wymaga obecności).
    # Dla slotu ONLINE bez znaczenia.
    allow_online: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    appointment_notes: Mapped[str | None] = mapped_column(Text)
    # Cena wizyty prywatnej; NULL = wizyta bezpłatna/NFZ (rozszerzenie ERD)
    price: Mapped[float | None] = mapped_column(Numeric(8, 2))
    # Czy wysłano przypomnienie 24h przed wizytą (UC-P7)
    reminder_sent: Mapped[bool] = mapped_column(Boolean, default=False)
    # Pacjent chce powiadomienie, gdy u tego lekarza zwolni się WCZEŚNIEJSZY termin
    # (rozszerzenie ERD)
    notify_earlier: Mapped[bool] = mapped_column(Boolean, default=False)
    # Badania diagnostyczne (rozszerzenie ERD):
    # nazwa badania (NULL = wizyta lekarska), wymóg skierowania,
    # podpięte skierowanie z apki LUB oświadczenie o zewnętrznym
    service_name: Mapped[str | None] = mapped_column(String(100))
    referral_required: Mapped[bool] = mapped_column(Boolean, default=False)
    # FK dodawany w migracji osobno (cykl appointment<->medical_document psuje
    # topologiczne sortowanie autogenerate)
    referral_document_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("medical_document.document_id", use_alter=True, name="fk_appointment_referral_doc"))
    external_referral: Mapped[bool] = mapped_column(Boolean, default=False)
    # Potwierdzanie obecności (gdy placówka wymaga): czy wysłano prośbę
    # i czy pacjent potwierdził, że będzie
    confirmation_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    patient_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    # token do potwierdzenia/odwołania wizyty z linka SMS (bez logowania)
    confirmation_token: Mapped[str | None] = mapped_column(String(43), unique=True)

    patient = relationship("Patient")
    doctor = relationship("Doctor")
    nurse = relationship("Nurse")
    clinic = relationship("Clinic")
