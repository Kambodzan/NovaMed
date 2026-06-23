"""Widoczność dokumentacji klinicznej per ROLA (RODO — „minimum niezbędne"),
poszerzana ŚWIADOMYM udostępnieniem pacjenta (kod, UC-P6).

Bramka placówkowa (`tenancy`) rozstrzyga, O KTÓRYM pacjencie personel może czytać;
tu rozstrzygamy, CO z jego dokumentacji widzi dana rola:

- lekarz — pełnia (zespół opiekuńczy placówki; cross-placówka i tak za kodem).
- pielęgniarka — leki (recepty), wyniki badań, skierowania zabiegowe
  (pielęgniarskie/laboratoryjne) + dane kliniczne (alergie/choroby/leki). Bez not
  z wizyt, e-zwolnień, zaświadczeń, skierowań do specjalisty (docx UC-N1, §7.3).
- rejestracja — rola administracyjna; z klinicznych tylko wyniki badań
  (obsługuje ich wgrywanie). Bez recept, not, skierowań, danych klinicznych.
- kierownik / administrator — role administracyjne; bez dokumentacji klinicznej.

PONAD tym: jeśli pacjent UDOSTĘPNIŁ pracownikowi dokumentację kodem (odebrany,
nieodwołany `DocumentShare`), to ten pracownik widzi też dokumenty/noty w zakresie
udostępnienia — także te poza domyślnym zakresem roli i z innej placówki. To jest
świadoma zgoda pacjenta, więc rozszerza dostęp także w zwykłej kartotece.
"""
from datetime import datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.documents import DocumentType, ReferralType
from app.domain.tenancy import staff_can_access_patient
from app.models import AppUser, DocumentShare, MedicalDocument, Referral

# role klinicystyczne — widzą dane kliniczne pacjenta (alergie/choroby/leki na stałe)
CLINICAL_ROLES = ("lekarz", "pielegniarka")
# zakresy udostępnienia obejmujące podpisane noty z wizyt
NOTE_SCOPES = ("ALL", "LAST_12M")


def can_view_clinical_data(role: str) -> bool:
    """Alergie, choroby przewlekłe, leki na stałe — tylko klinicyści."""
    return role in CLINICAL_ROLES


def assert_can_read_patient(db: Session, user: AppUser, patient_id) -> None:
    """Dostęp do ODCZYTU kartoteki: placówka (tenancy) ALBO świadome udostępnienie
    pacjenta (kod). Zapisy (edycja danych, rezerwacje) zostają wyłącznie placówkowe."""
    if staff_can_access_patient(db, user, patient_id):
        return
    if active_shares(db, user.user_id, patient_id):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Pacjent nie jest przypisany do Twojej placówki. Aby zobaczyć jego "
               "dokumentację, poproś pacjenta o kod udostępnienia.",
    )


def active_shares(db: Session, recipient_id, patient_id) -> list[DocumentShare]:
    """Aktywne (odebrane przez tego pracownika, nieodwołane) udostępnienia pacjenta."""
    return list(db.scalars(
        select(DocumentShare).where(
            DocumentShare.patient_id == patient_id,
            DocumentShare.recipient_id == recipient_id,
            DocumentShare.redeemed_at.is_not(None),
            DocumentShare.revoked.is_(False),
        )
    ))


def _scope_covers(scope: str, doc: MedicalDocument) -> bool:
    if scope == "ALL":
        return True
    if scope == "PRESCRIPTION":
        return doc.document_type == DocumentType.PRESCRIPTION.value
    if scope == "LAB_RESULT":
        return doc.document_type == DocumentType.LAB_RESULT.value
    if scope == "LAST_12M":
        return doc.issued_at >= datetime.now() - timedelta(days=365)
    return False


def can_view_visit_notes(role: str, shares: list[DocumentShare] = ()) -> bool:
    """Przebieg wizyty (nota lekarska + uzupełnienia) — lekarz albo udostępnienie
    obejmujące noty (zakres ogólny / ostatnie 12 mies.)."""
    return role == "lekarz" or any(s.scope in NOTE_SCOPES for s in shares)


def can_view_document(db: Session, role: str, doc: MedicalDocument,
                      shares: list[DocumentShare] = ()) -> bool:
    """Czy rola (z ew. udostępnieniem) może zobaczyć konkretny dokument."""
    if role == "lekarz":
        return True
    if _role_default_visible(db, role, doc):
        return True
    return any(_scope_covers(s.scope, doc) for s in shares)


def _role_default_visible(db: Session, role: str, doc: MedicalDocument) -> bool:
    t = doc.document_type
    if role == "pielegniarka":
        if t in (DocumentType.PRESCRIPTION.value, DocumentType.LAB_RESULT.value):
            return True
        if t == DocumentType.REFERRAL.value:
            sub = db.scalar(select(Referral.referral_type).where(Referral.document_id == doc.document_id))
            return sub in (ReferralType.NURSING.value, ReferralType.LAB.value)
        return False
    if role == "rejestracja":
        return t == DocumentType.LAB_RESULT.value
    return False  # kierownik, administrator — administracyjni


def filter_documents(db: Session, role: str, docs, shares: list[DocumentShare] = ()) -> list[MedicalDocument]:
    if role == "lekarz":
        return list(docs)
    return [d for d in docs if can_view_document(db, role, d, shares)]
