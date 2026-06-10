# Lista oczekujących na termin (UC-P3 A1) — ROZSZERZENIE względem oryginalnego
# ERD.
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class WaitingListEntry(Base):
    __tablename__ = "waiting_list"

    entry_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patient.patient_id"))
    specialization: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    patient = relationship("Patient")
