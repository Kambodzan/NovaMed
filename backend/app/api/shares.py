# Udostępnianie dokumentacji jednorazowym kodem (UC-P6).
# Pacjent generuje kod (zakres + ważność) i przekazuje go personelowi;
# lekarz/pielęgniarka otwierają kodem podgląd dokumentacji w zakresie.
from uuid import UUID
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.auth import require_roles
from app.core.db import get_db
from app.domain.audit import log_access
from app.api.documents import DocumentOut, document_out
from app.models import (
    Appointment, AppUser, AuditLog, ClinicalNote, DocumentShare, MedicalDocument, Patient,
)

router = APIRouter(prefix="/shares", tags=["shares"])

# Ochrona przed zgadywaniem kodów (enumeracja) przez konto personelu: po serii
# nieudanych prób w krótkim oknie blokujemy /access (licznik z audit logu).
SHARE_FAIL_WINDOW_MIN = 10
SHARE_FAIL_LIMIT = 10

# bez znaków mylących (0/O, 1/I/L)
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
SCOPES = ("ALL", "PRESCRIPTION", "LAB_RESULT", "LAST_12M")
SCOPE_LABELS = {
    "ALL": "cała dokumentacja",
    "PRESCRIPTION": "tylko e-recepty",
    "LAB_RESULT": "tylko wyniki badań",
    "LAST_12M": "dokumenty z ostatnich 12 miesięcy",
}


def _scoped_doc_query(patient_id: UUID, scope: str):
    q = select(MedicalDocument).where(MedicalDocument.patient_id == patient_id)
    if scope in ("PRESCRIPTION", "LAB_RESULT"):
        q = q.where(MedicalDocument.document_type == scope)
    elif scope == "LAST_12M":
        q = q.where(MedicalDocument.issued_at >= datetime.now() - timedelta(days=365))
    return q.order_by(MedicalDocument.issued_at.desc())


def _scoped_note_query(patient_id: UUID, scope: str):
    """Podpisane noty z wizyt wchodzą tylko w zakres ogólny i „ostatnie 12 mies."."""
    if scope not in ("ALL", "LAST_12M"):
        return None
    nq = select(ClinicalNote).where(
        ClinicalNote.patient_id == patient_id, ClinicalNote.status == "SIGNED")
    if scope == "LAST_12M":
        nq = nq.where(ClinicalNote.signed_at >= datetime.now() - timedelta(days=365))
    return nq.order_by(ClinicalNote.signed_at.desc())


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
    share_id: UUID
    access_code: str
    scope: str
    scope_label: str
    expires_at: datetime
    revoked: bool


class AccessIn(BaseModel):
    code: str = Field(min_length=6, max_length=10)


class SharedNoteOut(BaseModel):
    appointment_id: UUID
    date: datetime
    doctor_name: str
    content: str
    addenda: list[str] = []


class SharedDocsOut(BaseModel):
    patient_id: UUID
    patient_name: str
    pesel: str
    scope_label: str
    expires_at: datetime
    documents: list[DocumentOut]
    notes: list[SharedNoteOut] = []


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


class SharePreviewOut(BaseModel):
    scope: str
    scope_label: str
    document_count: int
    note_count: int  # podpisane noty z wizyt (treści kliniczne) w tym zakresie


@router.get("/preview", response_model=SharePreviewOut)
def preview_share(
    scope: str = "ALL",
    user: AppUser = Depends(require_roles("pacjent")),
    db: Session = Depends(get_db),
):
    """Podgląd „co zobaczy odbiorca" zanim pacjent wygeneruje kod — liczba
    dokumentów i (osobno) notatek lekarskich w danym zakresie."""
    if scope not in SCOPES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Nieznany zakres udostępnienia.")
    docs = db.scalars(_scoped_doc_query(user.user_id, scope)).all()
    nq = _scoped_note_query(user.user_id, scope)
    note_count = len(db.scalars(nq).all()) if nq is not None else 0
    return SharePreviewOut(
        scope=scope, scope_label=SCOPE_LABELS.get(scope, scope),
        document_count=len(docs), note_count=note_count,
    )


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
    share_id: UUID,
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
    user: AppUser = Depends(require_roles("lekarz", "pielegniarka")),
    db: Session = Depends(get_db),
):
    """Personel otwiera dokumentację kodem od pacjenta (podgląd w zakresie kodu)."""
    # Rate-limit: zbyt wiele nieudanych prób z jednego konta = próba zgadywania kodu.
    recent_fails = db.scalar(
        select(func.count()).select_from(AuditLog).where(
            AuditLog.actor_id == user.user_id,
            AuditLog.action == "ACCESS_SHARE_FAIL",
            AuditLog.created_at >= datetime.now() - timedelta(minutes=SHARE_FAIL_WINDOW_MIN),
        )) or 0
    if recent_fails >= SHARE_FAIL_LIMIT:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail="Zbyt wiele nieudanych prób z tego konta — odczekaj kilka minut.")

    code = body.code.strip().upper()
    share = db.scalar(select(DocumentShare).where(DocumentShare.access_code == code))
    if share is None:
        log_access(db, actor=user, action="ACCESS_SHARE_FAIL", detail=f"zly kod {code[:12]}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Nie ma takiego kodu — sprawdź pisownię (bez O/0 i I/1).")
    if share.revoked:
        log_access(db, actor=user, action="ACCESS_SHARE_FAIL", patient_id=share.patient_id,
                   detail=f"kod uniewazniony {code}")
        raise HTTPException(status_code=status.HTTP_410_GONE,
                            detail="Ten kod został unieważniony przez pacjenta — poproś o nowy.")
    if share.expires_at <= datetime.now():
        log_access(db, actor=user, action="ACCESS_SHARE_FAIL", patient_id=share.patient_id,
                   detail=f"kod wygasl {code}")
        raise HTTPException(status_code=status.HTTP_410_GONE,
                            detail=f"Ten kod wygasł {share.expires_at.strftime('%d.%m.%Y %H:%M')} — poproś pacjenta o nowy.")

    log_access(db, actor=user, action="ACCESS_SHARE", patient_id=share.patient_id,
               detail=f"kod {share.access_code} ({share.scope})")

    docs = db.scalars(_scoped_doc_query(share.patient_id, share.scope)).all()

    # noty z wizyt (podpisane) — w zakresie ogólnym i „ostatnie 12 mies."
    notes: list[SharedNoteOut] = []
    nq = _scoped_note_query(share.patient_id, share.scope)
    if nq is not None:
        for n in db.scalars(nq):
            author = db.get(AppUser, n.author_id)
            appt = db.get(Appointment, n.appointment_id)
            notes.append(SharedNoteOut(
                appointment_id=n.appointment_id,
                date=appt.appointment_datetime if appt else (n.signed_at or n.created_at),
                doctor_name=author.username if author else "—",
                content=n.content,
                addenda=[a.content for a in n.addenda],
            ))

    patient = db.get(Patient, share.patient_id)
    return SharedDocsOut(
        patient_id=patient.patient_id,
        patient_name=f"{patient.first_name} {patient.last_name}",
        pesel=patient.pesel,
        scope_label=SCOPE_LABELS.get(share.scope, share.scope),
        expires_at=share.expires_at,
        documents=[document_out(db, d) for d in docs],
        notes=notes,
    )
