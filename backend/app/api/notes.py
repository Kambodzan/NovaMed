# Nota z wizyty (encounter note) — pełny cykl jak w EHR:
# JEDNA nota na wizytę, szkic edytowalny do podpisu, po podpisie zablokowana,
# zmiany tylko przez uzupełnienia (addenda); pełny audyt/wersjonowanie (note_event).
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.family import allowed_patient_ids
from app.core.auth import get_current_user, require_roles
from app.core.db import get_db
from app.domain.audit import log_access
from app.domain.tenancy import assert_staff_can_access_patient
from app.models import Appointment, AppUser, ClinicalNote, NoteAddendum, NoteEvent

router = APIRouter(tags=["notes"])

STAFF = ("lekarz", "rejestracja", "kierownik", "administrator", "pielegniarka")


class NoteContentIn(BaseModel):
    content: str = Field(min_length=1)


class AddendumOut(BaseModel):
    author_name: str
    content: str
    created_at: datetime


class EventOut(BaseModel):
    actor_name: str
    action: str
    created_at: datetime


class NoteOut(BaseModel):
    note_id: UUID | None = None
    appointment_id: UUID
    status: str               # DRAFT / SIGNED / EMPTY (brak noty)
    content: str
    author_name: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    signed_at: datetime | None = None
    signed_by_name: str | None = None
    addenda: list[AddendumOut] = []
    events: list[EventOut] = []   # audyt — tylko dla personelu


def _name(db: Session, user_id: UUID | None) -> str | None:
    if user_id is None:
        return None
    u = db.get(AppUser, user_id)
    return u.username if u else None


def note_out(db: Session, note: ClinicalNote, *, with_events: bool) -> NoteOut:
    return NoteOut(
        note_id=note.note_id,
        appointment_id=note.appointment_id,
        status=note.status,
        content=note.content,
        author_name=_name(db, note.author_id),
        created_at=note.created_at,
        updated_at=note.updated_at,
        signed_at=note.signed_at,
        signed_by_name=_name(db, note.signed_by),
        addenda=[AddendumOut(author_name=_name(db, a.author_id) or "—", content=a.content, created_at=a.created_at)
                 for a in note.addenda],
        events=[EventOut(actor_name=_name(db, e.actor_id) or "—", action=e.action, created_at=e.created_at)
                for e in note.events] if with_events else [],
    )


def _visit_doctor_or_403(db: Session, appointment_id: UUID, user: AppUser) -> Appointment:
    a = db.get(Appointment, appointment_id)
    if a is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wizyta nie istnieje.")
    if a.doctor_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="To nie jest wizyta tego lekarza.")
    return a


def get_or_create_note(db: Session, a: Appointment, author_id: UUID) -> ClinicalNote:
    note = db.scalar(select(ClinicalNote).where(ClinicalNote.appointment_id == a.appointment_id))
    if note is None:
        note = ClinicalNote(appointment_id=a.appointment_id, patient_id=a.patient_id,
                            author_id=author_id, content="", status="DRAFT")
        db.add(note)
        db.flush()
        db.add(NoteEvent(note_id=note.note_id, actor_id=author_id, action="CREATED"))
    return note


@router.get("/appointments/{appointment_id}/note", response_model=NoteOut)
def get_note(
    appointment_id: UUID,
    user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Nota wizyty. Lekarz prowadzący widzi wszystko (w tym szkic + audyt);
    pacjent/opiekun — tylko PODPISANĄ notę (bez audytu, bez szkicu)."""
    a = db.get(Appointment, appointment_id)
    if a is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wizyta nie istnieje.")
    role = user.role.role_name
    # każdy lekarz czyta notę (EHR); edycję/podpis pilnują osobne endpointy
    is_doctor = role == "lekarz"
    is_patient = role == "pacjent" and a.patient_id in allowed_patient_ids(db, user)
    if not (is_doctor or is_patient or role in ("rejestracja", "kierownik", "administrator")):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Brak dostępu do noty tej wizyty.")

    note = db.scalar(select(ClinicalNote).where(ClinicalNote.appointment_id == appointment_id))
    if note is None or (is_patient and note.status != "SIGNED"):
        # pacjent nie widzi szkicu; brak noty = pusty placeholder
        return NoteOut(appointment_id=appointment_id, status="EMPTY", content="")
    if role != "pacjent":
        assert_staff_can_access_patient(db, user, a.patient_id)
        log_access(db, actor=user, action="VIEW_NOTE", patient_id=a.patient_id)
    return note_out(db, note, with_events=is_doctor or role in ("kierownik", "administrator"))


@router.put("/appointments/{appointment_id}/note", response_model=NoteOut)
def save_note(
    appointment_id: UUID,
    body: NoteContentIn,
    user: AppUser = Depends(require_roles("lekarz")),
    db: Session = Depends(get_db),
):
    """Zapis szkicu noty (upsert — JEDNA nota na wizytę). Po podpisaniu zablokowane
    (zmiany tylko przez uzupełnienia). Każdy zapis = wpis audytu ze snapshotem."""
    a = _visit_doctor_or_403(db, appointment_id, user)
    note = get_or_create_note(db, a, user.user_id)
    if note.status == "SIGNED":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Nota jest podpisana — dodaj uzupełnienie zamiast edytować.")
    note.content = body.content
    db.add(NoteEvent(note_id=note.note_id, actor_id=user.user_id, action="SAVED",
                     content_snapshot=body.content))
    db.commit()
    return note_out(db, note, with_events=True)


@router.post("/appointments/{appointment_id}/note/sign", response_model=NoteOut)
def sign_note(
    appointment_id: UUID,
    user: AppUser = Depends(require_roles("lekarz")),
    db: Session = Depends(get_db),
):
    """Podpisanie noty (DRAFT→SIGNED) — blokuje edycję. Wymaga treści."""
    _visit_doctor_or_403(db, appointment_id, user)
    note = db.scalar(select(ClinicalNote).where(ClinicalNote.appointment_id == appointment_id))
    if note is None or not note.content.strip():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Pusta nota — nie ma czego podpisać.")
    if note.status == "SIGNED":
        return note_out(db, note, with_events=True)
    note.status = "SIGNED"
    note.signed_at = datetime.now()
    note.signed_by = user.user_id
    db.add(NoteEvent(note_id=note.note_id, actor_id=user.user_id, action="SIGNED",
                     content_snapshot=note.content))
    db.commit()
    return note_out(db, note, with_events=True)


@router.post("/appointments/{appointment_id}/note/addenda", response_model=NoteOut)
def add_addendum(
    appointment_id: UUID,
    body: NoteContentIn,
    user: AppUser = Depends(require_roles("lekarz")),
    db: Session = Depends(get_db),
):
    """Uzupełnienie do podpisanej noty (osobny, niezmienny wpis z autorem i datą).
    Może je dodać KAŻDY lekarz (np. konsultujący), nie tylko prowadzący — jak w EHR."""
    appt = db.get(Appointment, appointment_id)
    if appt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wizyta nie istnieje.")
    note = db.scalar(select(ClinicalNote).where(ClinicalNote.appointment_id == appointment_id))
    if note is None or note.status != "SIGNED":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Uzupełnienie można dodać dopiero do podpisanej noty.")
    assert_staff_can_access_patient(db, user, appt.patient_id)
    log_access(db, actor=user, action="ADD_ADDENDUM", patient_id=appt.patient_id,
               detail="uzupelnienie do podpisanej noty")
    db.add(NoteAddendum(note_id=note.note_id, author_id=user.user_id, content=body.content))
    db.add(NoteEvent(note_id=note.note_id, actor_id=user.user_id, action="ADDENDUM",
                     content_snapshot=body.content))
    db.commit()
    db.refresh(note)
    return note_out(db, note, with_events=True)


def autosign_note(db: Session, appointment_id: UUID) -> None:
    """Auto-podpis przy zakończeniu wizyty — nic nie zostaje w szkicu.
    Wołane z change_status (COMPLETED). Pustej noty nie tworzy."""
    note = db.scalar(select(ClinicalNote).where(ClinicalNote.appointment_id == appointment_id))
    if note and note.status == "DRAFT" and note.content.strip():
        note.status = "SIGNED"
        note.signed_at = datetime.now()
        note.signed_by = note.author_id
        db.add(NoteEvent(note_id=note.note_id, actor_id=note.author_id, action="SIGNED",
                         content_snapshot=note.content))
