# Konta rodzinne (rozszerzenie): opiekun (pacjent) zakłada
# profile podopiecznych i działa w ich imieniu (parametr ?as_patient=).
# Podopieczny nie loguje się sam: app_user.active_account = False, brak konta
# w Supabase (syntetyczny supabase_uid), a powiadomienia trafiają do opiekuna.
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import require_roles
from app.core.db import get_db
from app.models import AppUser, Patient, Role

router = APIRouter(prefix="/family", tags=["family"])


class DependentIn(BaseModel):
    first_name: str = Field(min_length=1, max_length=50)
    last_name: str = Field(min_length=1, max_length=50)
    pesel: str = Field(min_length=11, max_length=11, pattern=r"^\d{11}$")
    birth_date: date


class DependentOut(BaseModel):
    patient_id: int
    first_name: str
    last_name: str
    pesel: str
    birth_date: date


def resolve_patient_id(db: Session, user: AppUser, as_patient: int | None) -> int:
    """Pacjent działa za siebie albo za podopiecznego (patient.guardian_id)."""
    if as_patient is None or as_patient == user.user_id:
        return user.user_id
    dependent = db.get(Patient, as_patient)
    if dependent is None or dependent.guardian_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="To nie jest profil Twojego podopiecznego.")
    return as_patient


def allowed_patient_ids(db: Session, user: AppUser) -> set[int]:
    """Pacjenci, w których imieniu może działać użytkownik (on sam + podopieczni)."""
    ids = {user.user_id}
    ids.update(db.scalars(select(Patient.patient_id).where(Patient.guardian_id == user.user_id)))
    return ids


@router.post("", status_code=status.HTTP_201_CREATED, response_model=DependentOut)
def add_dependent(
    body: DependentIn,
    user: AppUser = Depends(require_roles("pacjent")),
    db: Session = Depends(get_db),
):
    if db.scalar(select(Patient).where(Patient.pesel == body.pesel)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Pacjent z tym numerem PESEL już istnieje.")
    role = db.scalar(select(Role).where(Role.role_name == "pacjent"))
    account = AppUser(
        role_id=role.role_id,
        supabase_uid=uuid.uuid4(),  # syntetyczne — podopieczny nie ma konta w Supabase
        username=f"{body.first_name} {body.last_name}",
        email=f"podopieczny.{body.pesel}@family.novamed.local",
        active_account=False,
    )
    db.add(account)
    db.flush()
    db.add(Patient(
        patient_id=account.user_id,
        first_name=body.first_name,
        last_name=body.last_name,
        pesel=body.pesel,
        birth_date=body.birth_date,
        guardian_id=user.user_id,
    ))
    db.commit()
    return DependentOut(patient_id=account.user_id, **body.model_dump())


@router.get("", response_model=list[DependentOut])
def my_dependents(
    user: AppUser = Depends(require_roles("pacjent")),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(Patient).where(Patient.guardian_id == user.user_id).order_by(Patient.birth_date)
    )
    return [
        DependentOut(
            patient_id=p.patient_id, first_name=p.first_name, last_name=p.last_name,
            pesel=p.pesel, birth_date=p.birth_date,
        )
        for p in rows
    ]
