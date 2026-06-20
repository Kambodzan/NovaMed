# Katalog usług (typów wizyt/przyjęć) placówki: konsultacja, USG, pakiet
# „konsultacja + echo" itd. — każda z własnym czasem i ceną. Lekarz robi wybrane
# usługi (doctor_service). Slot kopiuje z usługi nazwę/cenę/czas.
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Service(Base):
    __tablename__ = "service"

    service_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    clinic_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clinic.clinic_id"))
    name: Mapped[str] = mapped_column(String(120))
    specialization: Mapped[str | None] = mapped_column(String(100))  # do filtrowania w wyszukiwarce
    duration_min: Mapped[int] = mapped_column(Integer, default=15)   # czas usługi = krok siatki terminów
    price: Mapped[float | None] = mapped_column(Numeric(8, 2))       # NULL = NFZ/bezpłatna
    referral_required: Mapped[bool] = mapped_column(Boolean, default=False)
    # czy usługę można odbyć jako teleporadę (konsultacja: tak; badanie USG/echo: nie).
    # Slot usługowy dziedziczy tę flagę → pacjent może wybrać wideo („albo/albo"). #46
    allow_online: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    description: Mapped[str | None] = mapped_column(Text)            # np. składniki pakietu
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    clinic = relationship("Clinic")
    doctors: Mapped[list["DoctorService"]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class DoctorService(Base):
    """Które usługi wykonuje dany lekarz (M:N lekarz↔usługa)."""

    __tablename__ = "doctor_service"
    __table_args__ = (UniqueConstraint("doctor_id", "service_id", name="uq_doctor_service"),)

    doctor_service_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    doctor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("doctor.doctor_id"))
    service_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("service.service_id"))
