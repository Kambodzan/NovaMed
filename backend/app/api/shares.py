# Udostępnianie dokumentacji jednorazowym kodem (UC-P6).
# Pacjent generuje kod (zakres + ważność) i przekazuje go personelowi;
# lekarz/pielęgniarka otwierają kodem podgląd dokumentacji w zakresie.
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import require_roles
from app.core.db import get_db
from app.api.documents import DocumentOut, document_out
from app.models import AppUser, DocumentShare, MedicalDocument, Patient

router = APIRouter(prefix="/shares", tags=["shares"])

# bez znaków mylących (0/O, 1/I/L)
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
SCOPES = ("ALL", "PRESCRIPTION", "LAB_RESULT", "LAST_12M")
SCOPE_LABELS = {
    "ALL": "cała dokumentacja",
    "PRESCRIPTION": "tylko e-recepty",
    "LAB_RESULT": "tylko wyniki badań",
    "LAST_12M": "dokumenty z ostatnich 12 miesięcy",
}


def generate_code(db: Session) -> str:
    while True:
        raw = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
        code = f"{raw[:3]}-{raw[3:]}"
        if not db.scalar(select(DocumentShare).where(DocumentShare.access_code == code)):
            return code


class ShareIn(BaseModel):
    scope: str = Field(default="ALL")
    hours_valid: int = Field(default=24, ge=1, le=24 * 30)


class ShareOut(BaseModel):
    share_id: int
    access_code: str
    scope: str
    scope_label: str
    expires_at: datetime
    revoked: bool


class AccessIn(BaseModel):
    code: str = Field(min_length=6, max_length=10)


class SharedDocsOut(BaseModel):
    patient_id: int
    patient_name: str
    pesel: str
    scope_label: str
    expires_at: datetime
    documents: list[DocumentOut]


def share_out(s: DocumentShare) -> ShareOut:
    return ShareOut(
        share_id=s.share_id, access_code=s.access_code, scope=s.scope,
        scope_label=SCOPE_LABELS.get(s.scope, s.scope),
        expires_at=s.expires_at, revoked=s.revoked,
    )


@router.post("", status_code=status.HTTP_201_CREATED, response_model=ShareOut)
def create_share(
    body: ShareIn,
    user: AppUser = Depends(require_roles("pacjent")),
    db: Session = Depends(get_db),
):
    if body.scope not in SCOPES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Nieznany zakres udostępnienia.")
    share = DocumentShare(
        patient_id=user.user_id,
        access_code=generate_code(db),
        scope=body.scope,
        expires_at=datetime.now() + timedelta(hours=body.hours_valid),
    )
    db.add(share)
    db.commit()
    return share_out(share)


@router.get("/my", response_model=list[ShareOut])
def my_shares(
    user: AppUser = Depends(require_roles("pacjent")),
    db: Session = Depends(get_db),
):
    """Aktywne (nieunieważnione, niewygasłe) udostępnienia pacjenta."""
    rows = db.scalars(
        select(DocumentShare).where(
            DocumentShare.patient_id == user.user_id,
            DocumentShare.revoked.is_(False),
            DocumentShare.expires_at > datetime.now(),
        ).order_by(DocumentShare.created_at.desc())
    )
    return [share_out(s) for s in rows]


@router.delete("/{share_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_share(
    share_id: int,
    user: AppUser = Depends(require_roles("pacjent")),
    db: Session = Depends(get_db),
):
    """UC-P6 A1: pacjent unieważnia kod w każdej chwili."""
    share = db.get(DocumentShare, share_id)
    if share is None or share.patient_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Udostępnienie nie istnieje.")
    share.revoked = True
    db.commit()


@router.post("/access", response_model=SharedDocsOut)
def access_by_code(
    body: AccessIn,
    _: AppUser = Depends(require_roles("lekarz", "pielegniarka")),
    db: Session = Depends(get_db),
):
    """Personel otwiera dokumentację kodem od pacjenta (podgląd w zakresie kodu)."""
    code = body.code.strip().upper()
    share = db.scalar(select(DocumentShare).where(DocumentShare.access_code == code))
    if share is None or share.revoked or share.expires_at <= datetime.now():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Kod jest nieprawidłowy, wygasł lub został unieważniony.",
        )

    q = select(MedicalDocument).where(MedicalDocument.patient_id == share.patient_id)
    if share.scope in ("PRESCRIPTION", "LAB_RESULT"):
        q = q.where(MedicalDocument.document_type == share.scope)
    elif share.scope == "LAST_12M":
        q = q.where(MedicalDocument.issued_at >= datetime.now() - timedelta(days=365))
    docs = db.scalars(q.order_by(MedicalDocument.issued_at.desc())).all()

    patient = db.get(Patient, share.patient_id)
    return SharedDocsOut(
        patient_id=patient.patient_id,
        patient_name=f"{patient.first_name} {patient.last_name}",
        pesel=patient.pesel,
        scope_label=SCOPE_LABELS.get(share.scope, share.scope),
        expires_at=share.expires_at,
        documents=[document_out(db, d) for d in docs],
    )
