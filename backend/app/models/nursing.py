import uuid

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class NursingProcedure(Base):
    """Zabieg pielęgniarski wykonywany na podstawie skierowania (referral)."""

    __tablename__ = "nursing_procedure"

    procedure_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    nurse_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("nurse.nurse_id"))
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patient.patient_id"))
    clinic_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clinic.clinic_id"))
    appointment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("appointment.appointment_id"))
    referral_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("referral.referral_id"))
    procedure_type: Mapped[str] = mapped_column(String(100))
    procedure_status: Mapped[str] = mapped_column(String(50))
    procedure_datetime: Mapped[datetime] = mapped_column(DateTime)
    notes: Mapped[str | None] = mapped_column(Text)

    nurse = relationship("Nurse")
    patient = relationship("Patient")
    clinic = relationship("Clinic")
    appointment = relationship("Appointment")
    referral = relationship("Referral")
