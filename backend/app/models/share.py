# Udostępnianie dokumentacji kodem (UC-P6) — ROZSZERZENIE względem oryginalnego
# ERD. Model „kod aktywuje TRWAŁY dostęp" (#26):
# pacjent generuje kod (ważny krótko, tylko na ODEBRANIE), pierwszy pracownik,
# który go użyje, zostaje przypięty jako odbiorca i ma dostęp do udostępnionego
# zakresu na stałe — aż pacjent go cofnie. expires_at = termin na odebranie kodu
# (przed redeemed_at); po odebraniu dostępu pilnuje już tylko revoked.
import uuid

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class DocumentShare(Base):
    __tablename__ = "document_share"

    share_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patient.patient_id"))
    access_code: Mapped[str] = mapped_column(String(10), unique=True)  # np. "K7M-4PD"
    scope: Mapped[str] = mapped_column(String(20))  # ALL / PRESCRIPTION / LAB_RESULT / LAST_12M
    expires_at: Mapped[datetime] = mapped_column(DateTime)  # termin NA ODEBRANIE kodu
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    # przypięcie kodu do pracownika, który go odebrał (NULL = jeszcze nieodebrany).
    # Po odebraniu dostęp jest TRWAŁY (do odwołania przez pacjenta), niezależnie od expires_at.
    recipient_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("app_user.user_id"))
    redeemed_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    patient = relationship("Patient")
