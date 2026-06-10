from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Review(Base):
    """Opinia po odbytej wizycie. doctor_id/clinic_id NULL-owalne:
    opinia może dotyczyć tylko lekarza, tylko kliniki albo obu (UC-P8)."""

    __tablename__ = "review"

    review_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_user.user_id"))
    doctor_id: Mapped[int | None] = mapped_column(ForeignKey("doctor.doctor_id"))
    clinic_id: Mapped[int | None] = mapped_column(ForeignKey("clinic.clinic_id"))
    rating: Mapped[int] = mapped_column(Integer)  # 1-5
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    user = relationship("AppUser")
    doctor = relationship("Doctor")
    clinic = relationship("Clinic")
