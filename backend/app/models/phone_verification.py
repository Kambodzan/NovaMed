# Weryfikacja numeru telefonu kodem SMS (OTP) dla ścieżek BEZ logowania:
# publiczna rezerwacja (/public/book) i potwierdzenie telefonu przy rejestracji.
# Dowód „kontroluję ten numer" — 6-cyfrowy kod, krótkie TTL, limit prób i wysyłek.
# ROZSZERZENIE względem oryginalnego ERD.
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class PhoneVerification(Base):
    __tablename__ = "phone_verification"

    verification_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    phone: Mapped[str] = mapped_column(String(20))            # znormalizowany E.164
    purpose: Mapped[str] = mapped_column(String(20))          # BOOKING / REGISTRATION
    code_hash: Mapped[str] = mapped_column(String(64))        # sha256(phone:code) — kodu nie trzymamy jawnie
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime)    # ważność kodu (od wysłania)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime)   # ustawione po poprawnym kodzie
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime)   # spożyte przez akcję (rezerwacja/rejestracja)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
