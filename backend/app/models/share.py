# Udostępnianie dokumentacji jednorazowym kodem (UC-P6) — ROZSZERZENIE
# względem oryginalnego ERD.
import uuid

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class DocumentShare(Base):
    __tablename__ = "document_share"

    share_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patient.patient_id"))
    access_code: Mapped[str] = mapped_column(String(10), unique=True)  # np. "K7M-4PD"
    scope: Mapped[str] = mapped_column(String(20))  # ALL / PRESCRIPTION / LAB_RESULT / LAST_12M
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    patient = relationship("Patient")
