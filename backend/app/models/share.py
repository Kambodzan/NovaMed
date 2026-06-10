# Udostępnianie dokumentacji jednorazowym kodem (UC-P6) — ROZSZERZENIE
# względem oryginalnego ERD.
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class DocumentShare(Base):
    __tablename__ = "document_share"

    share_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patient.patient_id"))
    access_code: Mapped[str] = mapped_column(String(10), unique=True)  # np. "K7M-4PD"
    scope: Mapped[str] = mapped_column(String(20))  # ALL / PRESCRIPTION / LAB_RESULT / LAST_12M
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    patient = relationship("Patient")
