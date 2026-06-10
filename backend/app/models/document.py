# Dokumentacja medyczna: dokument bazowy + specjalizacje 1:1
# (prescription / referral / lab_result / sick_leave) — zgodnie ze schematem danych.
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class MedicalDocument(Base):
    __tablename__ = "medical_document"

    document_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    appointment_id: Mapped[int] = mapped_column(ForeignKey("appointment.appointment_id"))
    patient_id: Mapped[int] = mapped_column(ForeignKey("patient.patient_id"))
    doctor_id: Mapped[int] = mapped_column(ForeignKey("doctor.doctor_id"))
    issued_at: Mapped[datetime] = mapped_column(DateTime)
    document_type: Mapped[str] = mapped_column(String(50))  # PRESCRIPTION/REFERRAL/LAB_RESULT/SICK_LEAVE/NOTE
    document_content: Mapped[str | None] = mapped_column(Text)
    document_status: Mapped[str] = mapped_column(String(50))

    appointment = relationship("Appointment")
    patient = relationship("Patient")
    doctor = relationship("Doctor")


class Prescription(Base):
    """Statusy: diagram stanów e-recepty (DRAFT/SENT_TO_P1/CONFIRMED/REALIZED/ERROR)."""

    __tablename__ = "prescription"

    prescription_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("medical_document.document_id"))
    prescription_code: Mapped[str] = mapped_column(String(50))  # kod z (mock) P1
    prescribed_drugs: Mapped[str] = mapped_column(Text)

    document = relationship("MedicalDocument")


class Referral(Base):
    __tablename__ = "referral"

    referral_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("medical_document.document_id"))
    referral_code: Mapped[str] = mapped_column(String(50))
    referral_type: Mapped[str] = mapped_column(String(100))  # m.in. zabieg pielęgniarski, badanie lab
    notes: Mapped[str | None] = mapped_column(Text)

    document = relationship("MedicalDocument")


class LabResult(Base):
    """Statusy zlecenia: diagram stanów badania."""

    __tablename__ = "lab_result"

    lab_result_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("medical_document.document_id"))
    test_type: Mapped[str] = mapped_column(String(100))
    test_description: Mapped[str | None] = mapped_column(Text)
    file_url: Mapped[str | None] = mapped_column(String(255))

    document = relationship("MedicalDocument")


class SickLeave(Base):
    __tablename__ = "sick_leave"

    sick_leave_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("medical_document.document_id"))
    sick_leave_code: Mapped[str] = mapped_column(String(50))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    sent_to_zus: Mapped[bool] = mapped_column(Boolean, default=False)

    document = relationship("MedicalDocument")
