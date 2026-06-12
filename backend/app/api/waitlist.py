from uuid import UUID
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import require_roles
from app.core.db import get_db
from app.models import AppUser, WaitingListEntry

router = APIRouter(prefix="/waiting-list", tags=["waiting-list"])


class WaitlistIn(BaseModel):
    specialization: str = Field(min_length=2, max_length=100)


class WaitlistOut(BaseModel):
    entry_id: UUID
    specialization: str
    created_at: datetime


@router.post("", status_code=status.HTTP_201_CREATED, response_model=WaitlistOut)
def join_waitlist(
    body: WaitlistIn,
    user: AppUser = Depends(require_roles("pacjent")),
    db: Session = Depends(get_db),
):
    """UC-P3 A1: zapis na listę oczekujących — powiadomimy, gdy pojawią się terminy."""
    dup = db.scalar(select(WaitingListEntry).where(
        WaitingListEntry.patient_id == user.user_id,
        WaitingListEntry.specialization == body.specialization,
    ))
    if dup:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Jesteś już na liście oczekujących do tej specjalizacji.")
    entry = WaitingListEntry(patient_id=user.user_id, specialization=body.specialization)
    db.add(entry)
    db.commit()
    return WaitlistOut(entry_id=entry.entry_id, specialization=entry.specialization, created_at=entry.created_at)


@router.get("/my", response_model=list[WaitlistOut])
def my_waitlist(
    user: AppUser = Depends(require_roles("pacjent")),
    db: Session = Depends(get_db),
):
    rows = db.scalars(select(WaitingListEntry).where(WaitingListEntry.patient_id == user.user_id))
    return [WaitlistOut(entry_id=e.entry_id, specialization=e.specialization, created_at=e.created_at) for e in rows]


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def leave_waitlist(
    entry_id: UUID,
    user: AppUser = Depends(require_roles("pacjent")),
    db: Session = Depends(get_db),
):
    entry = db.get(WaitingListEntry, entry_id)
    if entry is None or entry.patient_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wpis nie istnieje.")
    db.delete(entry)
    db.commit()
