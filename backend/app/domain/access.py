"""Widoczność dokumentacji klinicznej per ROLA (RODO — „minimum niezbędne").

Bramka placówkowa (`tenancy`) rozstrzyga, O KTÓRYM pacjencie personel może czytać;
tu rozstrzygamy, CO z jego dokumentacji widzi dana rola:

- **lekarz** — pełnia (zespół opiekuńczy placówki; cross-placówka i tak za kodem).
- **pielęgniarka** — leki (recepty), wyniki badań, skierowania zabiegowe
  (pielęgniarskie/laboratoryjne) + dane kliniczne (alergie/choroby/leki). Bez not
  z wizyt, e-zwolnień, zaświadczeń, skierowań do specjalisty (docx UC-N1, §7.3).
- **rejestracja** — rola administracyjna; z klinicznych tylko wyniki badań
  (obsługuje ich wgrywanie). Bez recept, not, skierowań, danych klinicznych.
- **kierownik / administrator** — role administracyjne (kadry/terminy/raporty,
  konta/system/RODO); bez wglądu w dokumentację kliniczną pacjentów.

Demografia (dane kontaktowe) i terminy wizyt są dostępne dla całego personelu —
potrzebne do identyfikacji i obsługi grafiku, nie są treścią medyczną.
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.documents import DocumentType, ReferralType
from app.models import MedicalDocument, Referral

# role klinicystyczne — widzą dane kliniczne pacjenta (alergie/choroby/leki na stałe)
CLINICAL_ROLES = ("lekarz", "pielegniarka")


def can_view_clinical_data(role: str) -> bool:
    """Alergie, choroby przewlekłe, leki na stałe — tylko klinicyści."""
    return role in CLINICAL_ROLES


def can_view_visit_notes(role: str) -> bool:
    """Przebieg wizyty (nota lekarska + uzupełnienia) — tylko lekarz."""
    return role == "lekarz"


def can_view_document(db: Session, role: str, doc: MedicalDocument) -> bool:
    """Czy dana rola może zobaczyć konkretny dokument medyczny."""
    if role == "lekarz":
        return True
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


def filter_documents(db: Session, role: str, docs) -> list[MedicalDocument]:
    if role == "lekarz":
        return list(docs)
    return [d for d in docs if can_view_document(db, role, d)]
