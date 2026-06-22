# Dokumentacja medyczna: dokument bazowy + specjalizacje 1:1
# (prescription / referral / lab_result / sick_leave) — zgodnie ze schematem danych.
import uuid

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class MedicalDocument(Base):
    __tablename__ = "medical_document"

    document_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # NULL dla wyniku „z papieru" wpisanego przez rejestrację — zewnętrzny lab,
    # bez wizyty w NovaMed ani lekarza wystawiającego
    appointment_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("appointment.appointment_id"))
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patient.patient_id"))
    doctor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("doctor.doctor_id"))
    issued_at: Mapped[datetime] = mapped_column(DateTime)
    document_type: Mapped[str] = mapped_column(String(50))  # PRESCRIPTION/REFERRAL/LAB_RESULT/SICK_LEAVE/NOTE
    document_content: Mapped[str | None] = mapped_column(Text)
    document_status: Mapped[str] = mapped_column(String(50))
    # kiedy pacjent obejrzał dokument (NULL = jeszcze nie) — do „nowych" wyników
    # badań w „Do zrobienia" na pulpicie pacjenta.
    patient_seen_at: Mapped[datetime | None] = mapped_column(DateTime)

    # foreign_keys jawnie: appointment.referral_document_id tworzy DRUGĄ ścieżkę FK
    # między tabelami (badanie → podpięte skierowanie), więc relacja byłaby niejednoznaczna
    appointment = relationship("Appointment", foreign_keys=[appointment_id])
    patient = relationship("Patient")
    doctor = relationship("Doctor")


class Prescription(Base):
    """Statusy: diagram stanów e-recepty (DRAFT/SENT_TO_P1/CONFIRMED/REALIZED/ERROR)."""

    __tablename__ = "prescription"

    prescription_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("medical_document.document_id"))
    prescription_code: Mapped[str] = mapped_column(String(50))  # kod z (mock) P1
    prescribed_drugs: Mapped[str] = mapped_column(Text)
    valid_until: Mapped[date | None] = mapped_column(Date)  # ważność e-recepty (domyślnie 30 dni)

    document = relationship("MedicalDocument")


class Referral(Base):
    __tablename__ = "referral"

    referral_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("medical_document.document_id"))
    referral_code: Mapped[str] = mapped_column(String(50))
    referral_type: Mapped[str] = mapped_column(String(100))  # m.in. zabieg pielęgniarski, badanie lab
    # cel skierowania do specjalisty (tylko SPECIALIST); NURSING/LAB nie używają
    specialization: Mapped[str | None] = mapped_column(String(100))
    notes: Mapped[str | None] = mapped_column(Text)

    document = relationship("MedicalDocument")


class LabResult(Base):
    """Statusy zlecenia: diagram stanów badania."""

    __tablename__ = "lab_result"

    lab_result_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("medical_document.document_id"))
    test_type: Mapped[str] = mapped_column(String(100))
    test_description: Mapped[str | None] = mapped_column(Text)
    file_url: Mapped[str | None] = mapped_column(String(255))
    # ustrukturyzowane wyniki z laboratorium: JSON listy analitów
    # [{name, value, unit, ref_low, ref_high}] — do oznaczania „poza normą"
    values_json: Mapped[str | None] = mapped_column(Text)

    document = relationship("MedicalDocument")


class SickLeave(Base):
    __tablename__ = "sick_leave"

    sick_leave_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("medical_document.document_id"))
    sick_leave_code: Mapped[str] = mapped_column(String(50))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    sent_to_zus: Mapped[bool] = mapped_column(Boolean, default=False)


class Certificate(Base):
    """Zaświadczenie lekarskie o stanie zdrowia — dokument lokalny (nie P1/ZUS):
    cel/przeznaczenie, treść (opis stanu zdrowia), data ważności."""

    __tablename__ = "certificate"

    certificate_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("medical_document.document_id"))
    certificate_code: Mapped[str] = mapped_column(String(50))
    purpose: Mapped[str] = mapped_column(String(200))   # np. „do pracodawcy", „do klubu sportowego"
    content: Mapped[str] = mapped_column(Text)          # treść zaświadczenia
    valid_until: Mapped[date | None] = mapped_column(Date)

    document = relationship("MedicalDocument")
