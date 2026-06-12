# Słowniki ICD-10 i leków — podpowiedzi (typeahead) przy wystawianiu dokumentów.
# Dane ładowane importerem scripts/import-dictionaries.py.
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.auth import require_roles
from app.core.db import get_db
from app.models import AppUser, Icd10Entry, MedicationEntry

router = APIRouter(prefix="/dictionaries", tags=["dictionaries"])

STAFF = ("lekarz", "pielegniarka", "rejestracja", "kierownik", "administrator")


class Icd10Out(BaseModel):
    code: str
    name: str


class MedicationOut(BaseModel):
    med_id: UUID
    name: str
    form: str | None
    strength: str | None


@router.get("/icd10", response_model=list[Icd10Out])
def search_icd10(
    q: str = Query(min_length=1, max_length=100),
    _: AppUser = Depends(require_roles(*STAFF)),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(Icd10Entry)
        .where(or_(Icd10Entry.code.ilike(f"{q}%"), Icd10Entry.name.ilike(f"%{q}%")))
        .order_by(Icd10Entry.code)
        .limit(15)
    )
    return [Icd10Out(code=r.code, name=r.name) for r in rows]


@router.get("/medications", response_model=list[MedicationOut])
def search_medications(
    q: str = Query(min_length=1, max_length=100),
    _: AppUser = Depends(require_roles(*STAFF)),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(MedicationEntry)
        .where(MedicationEntry.name.ilike(f"{q}%"))
        .order_by(MedicationEntry.name, MedicationEntry.strength)
        .limit(15)
    )
    return [MedicationOut(med_id=r.med_id, name=r.name, form=r.form, strength=r.strength) for r in rows]
