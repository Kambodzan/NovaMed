# Nota z wizyty (encounter/progress note) wzorowana na realnych EHR:
# JEDNA kanoniczna nota na wizytę (SOAP w treści), cykl DRAFT→SIGNED, po podpisaniu
# zablokowana — zmiany tylko przez uzupełnienia (addenda). Pełny audyt/wersjonowanie.
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class ClinicalNote(Base):
    __tablename__ = "clinical_note"

    note_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # jedna nota na wizytę — unikalność po appointment_id
    appointment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("appointment.appointment_id"), unique=True)
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patient.patient_id"))
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("doctor.doctor_id"))
    content: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="DRAFT")  # DRAFT / SIGNED
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    signed_at: Mapped[datetime | None] = mapped_column(DateTime)
    signed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("doctor.doctor_id"))

    addenda: Mapped[list["NoteAddendum"]] = relationship(
        back_populates="note", order_by="NoteAddendum.created_at", cascade="all, delete-orphan")
    events: Mapped[list["NoteEvent"]] = relationship(
        back_populates="note", order_by="NoteEvent.created_at", cascade="all, delete-orphan")


class NoteAddendum(Base):
    """Uzupełnienie noty po podpisaniu — osobny, niezmienny wpis (autor + data)."""

    __tablename__ = "note_addendum"

    addendum_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    note_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clinical_note.note_id"))
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("doctor.doctor_id"))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    note: Mapped["ClinicalNote"] = relationship(back_populates="addenda")


class NoteEvent(Base):
    """Audyt + wersjonowanie noty: kto, kiedy, jaka akcja, snapshot treści.
    Akcje: CREATED / SAVED (zapis szkicu) / SIGNED / ADDENDUM."""

    __tablename__ = "note_event"

    event_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    note_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clinical_note.note_id"))
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_user.user_id"))
    action: Mapped[str] = mapped_column(String(20))
    content_snapshot: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    note: Mapped["ClinicalNote"] = relationship(back_populates="events")
