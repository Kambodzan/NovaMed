from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Appointment(Base):
    """Wizyta. patient_id = NULL oznacza wolny termin (slot w kalendarzu).

    Statusy i przejścia: diagram stanów wizyty
    (FREE, TEMP_LOCK, CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED, NO_SHOW, INTERRUPTED).
    """

    __tablename__ = "appointment"

    appointment_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int | None] = mapped_column(ForeignKey("patient.patient_id"))
    doctor_id: Mapped[int] = mapped_column(ForeignKey("doctor.doctor_id"))
    nurse_id: Mapped[int | None] = mapped_column(ForeignKey("nurse.nurse_id"))
    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinic.clinic_id"))
    appointment_datetime: Mapped[datetime] = mapped_column(DateTime)
    appointment_status: Mapped[str] = mapped_column(String(50))
    appointment_type: Mapped[str] = mapped_column(String(50))  # ONLINE / STATIONARY
    appointment_notes: Mapped[str | None] = mapped_column(Text)
    # Cena wizyty prywatnej; NULL = wizyta bezpłatna/NFZ (rozszerzenie ERD)
    price: Mapped[float | None] = mapped_column(Numeric(8, 2))

    patient = relationship("Patient")
    doctor = relationship("Doctor")
    nurse = relationship("Nurse")
    clinic = relationship("Clinic")
