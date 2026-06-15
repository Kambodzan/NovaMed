from uuid import UUID
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import require_roles
from app.core.db import get_db
from app.domain.documents import DocumentStatus, ReferralType
from app.models import (
    AppUser, MedicalDocument, NursingProcedure, Patient, Referral,
)

router = APIRouter(prefix="/procedures", tags=["procedures"])

# Statusy zabiegu (spójne z makietami i StatusBadge na froncie)
ST_PLANNED = "PLANNED"
ST_DONE = "DONE"
ST_CANCELLED = "CANCELLED"


class PlanProcedureIn(BaseModel):
    referral_document_id: UUID
    procedure_datetime: datetime


class CompleteProcedureIn(BaseModel):
    notes: str = Field(min_length=2, description="Przebieg zabiegu — dokumentacja czynności pielęgniarskich (UC-N3)")


class RescheduleProcedureIn(BaseModel):
    procedure_datetime: datetime


class ProcedureOut(BaseModel):
    procedure_id: UUID
    procedure_datetime: datetime
    procedure_type: str
    procedure_status: str
    notes: str | None
    patient_id: UUID
    patient_name: str
    referral_code: str
    ordered_by: str


def procedure_out(db: Session, p: NursingProcedure) -> ProcedureOut:
    patient = db.get(Patient, p.patient_id)
    referral = db.get(Referral, p.referral_id)
    doc = db.get(MedicalDocument, referral.document_id)
    doctor_user = db.get(AppUser, doc.doctor_id)
    return ProcedureOut(
        procedure_id=p.procedure_id,
        procedure_datetime=p.procedure_datetime,
        procedure_type=p.procedure_type,
        procedure_status=p.procedure_status,
        notes=p.notes,
        patient_id=p.patient_id,
        patient_name=f"{patient.first_name} {patient.last_name}",
        referral_code=referral.referral_code,
        ordered_by=doctor_user.username,
    )


@router.post("", status_code=status.HTTP_201_CREATED, response_model=ProcedureOut)
def plan_procedure(
    body: PlanProcedureIn,
    user: AppUser = Depends(require_roles("pielegniarka")),
    db: Session = Depends(get_db),
):
    """UC-N2: zaplanowanie zabiegu na podstawie skierowania lekarskiego.
    Skierowanie z aktywnym zabiegiem znika z kolejki /referrals/nursing."""
    doc = db.get(MedicalDocument, body.referral_document_id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skierowanie nie istnieje.")
    referral = db.scalar(select(Referral).where(Referral.document_id == doc.document_id))
    if referral is None or referral.referral_type != ReferralType.NURSING.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="To nie jest skierowanie na zabieg pielęgniarski.")
    if doc.document_status != DocumentStatus.ACTIVE.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Skierowanie nie jest aktywne.")
    active = db.scalar(select(NursingProcedure).where(
        NursingProcedure.referral_id == referral.referral_id,
        NursingProcedure.procedure_status != ST_CANCELLED,
    ))
    if active:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Na to skierowanie zaplanowano już zabieg.")

    p = NursingProcedure(
        nurse_id=user.user_id,
        patient_id=doc.patient_id,
        clinic_id=doc.appointment.clinic_id,
        appointment_id=doc.appointment_id,
        referral_id=referral.referral_id,
        procedure_type=(referral.notes or "Zabieg pielęgniarski")[:100],
        procedure_status=ST_PLANNED,
        procedure_datetime=body.procedure_datetime,
    )
    db.add(p)
    db.commit()
    return procedure_out(db, p)


@router.get("/day", response_model=list[ProcedureOut])
def procedures_day(
    day: str = Query(description="Data w formacie YYYY-MM-DD"),
    user: AppUser = Depends(require_roles("pielegniarka")),
    db: Session = Depends(get_db),
):
    """UC-N2: plan dnia pielęgniarki."""
    try:
        start = datetime.fromisoformat(day)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Nieprawidłowa data.") from exc
    rows = db.scalars(
        select(NursingProcedure)
        .where(
            NursingProcedure.nurse_id == user.user_id,
            NursingProcedure.procedure_datetime >= start,
            NursingProcedure.procedure_datetime < start + timedelta(days=1),
        )
        .order_by(NursingProcedure.procedure_datetime)
    )
    return [procedure_out(db, p) for p in rows]


def get_own_procedure(procedure_id: UUID, user: AppUser, db: Session) -> NursingProcedure:
    p = db.get(NursingProcedure, procedure_id)
    if p is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Zabieg nie istnieje.")
    if p.nurse_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="To nie jest zabieg tej pielęgniarki.")
    return p


@router.post("/{procedure_id}/complete", response_model=ProcedureOut)
def complete_procedure(
    procedure_id: UUID,
    body: CompleteProcedureIn,
    user: AppUser = Depends(require_roles("pielegniarka")),
    db: Session = Depends(get_db),
):
    """UC-N3: odnotowanie wykonania + dokumentacja czynności; skierowanie → REALIZED."""
    p = get_own_procedure(procedure_id, user, db)
    if p.procedure_status != ST_PLANNED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Można odnotować tylko zaplanowany zabieg.")
    p.procedure_status = ST_DONE
    p.notes = body.notes
    referral = db.get(Referral, p.referral_id)
    doc = db.get(MedicalDocument, referral.document_id)
    doc.document_status = DocumentStatus.REALIZED.value
    db.commit()
    return procedure_out(db, p)


@router.post("/{procedure_id}/reschedule", response_model=ProcedureOut)
def reschedule_procedure(
    procedure_id: UUID,
    body: RescheduleProcedureIn,
    user: AppUser = Depends(require_roles("pielegniarka")),
    db: Session = Depends(get_db),
):
    """Przełożenie zaplanowanego zabiegu na inny termin — bez kasowania skierowania
    (pacjent dzwoni „proszę przesunąć"). Tylko zabieg PLANNED."""
    p = get_own_procedure(procedure_id, user, db)
    if p.procedure_status != ST_PLANNED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Przełożyć można tylko zaplanowany zabieg.")
    p.procedure_datetime = body.procedure_datetime
    db.commit()
    return procedure_out(db, p)


@router.post("/{procedure_id}/cancel", response_model=ProcedureOut)
def cancel_procedure(
    procedure_id: UUID,
    user: AppUser = Depends(require_roles("pielegniarka")),
    db: Session = Depends(get_db),
):
    """Odwołanie zaplanowanego zabiegu — skierowanie wraca do kolejki (UC-N2 A1)."""
    p = get_own_procedure(procedure_id, user, db)
    if p.procedure_status != ST_PLANNED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Można odwołać tylko zaplanowany zabieg.")
    p.procedure_status = ST_CANCELLED
    db.commit()
    return procedure_out(db, p)
