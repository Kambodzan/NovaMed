# Płatność online za wizytę — ROZSZERZENIE względem oryginalnego ERD
#
import uuid

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Payment(Base):
    __tablename__ = "payment"

    payment_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    appointment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("appointment.appointment_id"))
    amount: Mapped[float] = mapped_column(Numeric(8, 2))
    payment_status: Mapped[str] = mapped_column(String(20))  # PENDING / PAID / FAILED
    provider_ref: Mapped[str] = mapped_column(String(50))    # id płatności u operatora
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    paid_at: Mapped[datetime | None] = mapped_column(DateTime)
    # faktura (mini-mock): czy pacjent poprosił + nadany numer (FV/rok/nr)
    invoice_requested: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    invoice_number: Mapped[str | None] = mapped_column(String(40))

    appointment = relationship("Appointment")
