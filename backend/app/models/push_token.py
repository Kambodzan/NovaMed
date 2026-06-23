import uuid

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class PushToken(Base):
    """Token push urządzenia pacjenta (Expo Push Token). Jeden użytkownik może mieć
    wiele urządzeń → wiele tokenów. Token jest globalnie unikalny (reinstalacja/zmiana
    konta na tym samym urządzeniu = upsert na właściciela)."""

    __tablename__ = "push_token"

    push_token_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.user_id", ondelete="CASCADE"))
    token: Mapped[str] = mapped_column(String(256), unique=True)
    platform: Mapped[str] = mapped_column(String(16), default="expo")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    user = relationship("AppUser")
