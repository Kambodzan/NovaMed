# Płatność online za wizytę — ROZSZERZENIE względem oryginalnego ERD
#
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Payment(Base):
    __tablename__ = "payment"

    payment_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    appointment_id: Mapped[int] = mapped_column(ForeignKey("appointment.appointment_id"))
    amount: Mapped[float] = mapped_column(Numeric(8, 2))
    payment_status: Mapped[str] = mapped_column(String(20))  # PENDING / PAID / FAILED
    provider_ref: Mapped[str] = mapped_column(String(50))    # id płatności u operatora
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    paid_at: Mapped[datetime | None] = mapped_column(DateTime)

    appointment = relationship("Appointment")
