import uuid

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Notification(Base):
    __tablename__ = "notification"
    # unread-count (pollowany co 30s) i lista powiadomień: WHERE user_id=X [AND is_read=False]
    __table_args__ = (Index("ix_notification_user_read", "user_id", "is_read"),)

    notification_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.user_id"))
    sent_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    notification_title: Mapped[str] = mapped_column(String(100))
    notification_content: Mapped[str] = mapped_column(Text)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)

    user = relationship("AppUser")
