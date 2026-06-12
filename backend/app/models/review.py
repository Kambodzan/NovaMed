import uuid

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Review(Base):
    """Opinia po odbytej wizycie. doctor_id/clinic_id NULL-owalne:
    opinia może dotyczyć tylko lekarza, tylko kliniki albo obu (UC-P8)."""

    __tablename__ = "review"

    review_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.user_id"))
    # Powiązanie z wizytą (rozszerzenie ERD): UC-P8 wymaga
    # oceniania tylko ODBYTYCH wizyt i blokady duplikatów per wizyta.
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("appointment.appointment_id"))
    doctor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("doctor.doctor_id"))
    clinic_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("clinic.clinic_id"))
    rating: Mapped[int] = mapped_column(Integer)  # 1-5
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    user = relationship("AppUser")
    doctor = relationship("Doctor")
    clinic = relationship("Clinic")
