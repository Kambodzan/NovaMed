import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import require_roles
from app.core.db import get_db
from app.domain.audit import log_access
from app.domain.documents import DocumentStatus, DocumentType
from app.domain.notify import notify
from app.integrations.base import IntegrationError
from app.integrations.lab import LabClient, get_lab_client
from app.models import AppUser, LabResult, MedicalDocument, Patient, Referral

router = APIRouter(prefix="/integrations", tags=["integrations"])


class LabSyncOut(BaseModel):
    imported: int
    skipped: int


@router.post("/lab/sync", response_model=LabSyncOut)
def lab_sync(
    user: AppUser = Depends(require_roles("rejestracja", "kierownik", "administrator")),
    db: Session = Depends(get_db),
    lab: LabClient = Depends(get_lab_client),
):
    """UC-I2: pobranie gotowych wyników z laboratorium do dokumentacji.
    Docelowo wywoływane harmonogramem (konfiguracja w Panelu Admina, M8);
    teraz dostępne też ręcznie. Dedup po znaczniku źródła w file_url."""
    try:
        results = lab.fetch_ready_results()
    except IntegrationError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=exc.message) from exc

    imported = skipped = 0
    for r in results:
        code = r.get("referral_code", "")
        marker = f"mock-lab://{code}"
        referral = db.scalar(select(Referral).where(Referral.referral_code == code))
        if referral is None:
            skipped += 1
            continue
        exists = db.scalar(select(LabResult).where(LabResult.file_url == marker))
        if exists:
            skipped += 1
            lab.acknowledge(code)
            continue
        src = db.get(MedicalDocument, referral.document_id)
        doc = MedicalDocument(
            appointment_id=src.appointment_id,
            patient_id=src.patient_id,
            doctor_id=src.doctor_id,
            issued_at=datetime.now(),
            document_type=DocumentType.LAB_RESULT.value,
            document_content=None,
            document_status=DocumentStatus.READY.value,
        )
        db.add(doc)
        db.flush()
        analytes = r.get("analytes") or []
        db.add(LabResult(
            document_id=doc.document_id,
            test_type=r.get("test_type", "Badanie laboratoryjne")[:100],
            test_description=r.get("result"),
            file_url=marker,
            values_json=json.dumps(analytes, ensure_ascii=False) if analytes else None,
        ))
        # skierowanie LAB zrealizowane — wynik dotarł
        src.document_status = DocumentStatus.REALIZED.value
        test = r.get("test_type", "laboratoryjne")
        notify(db, src.patient_id, "Nowy wynik badania",
               f"Wynik badania ({test}) jest już dostępny w Twojej dokumentacji.")
        # wynik trafia też do lekarza ZLECAJĄCEGO — „skrzynka wyników do opisania"
        if src.doctor_id is not None:
            patient = db.get(Patient, src.patient_id)
            who = f"{patient.first_name} {patient.last_name}" if patient else "pacjenta"
            notify(db, src.doctor_id, "Wynik badania do opisania",
                   f"Dotarł wynik ({test}) — {who}. Sprawdź w zakładce Dokumenty.")
        log_access(db, actor=user, action="IMPORT_LAB_RESULT", patient_id=src.patient_id,
                   detail=f"wynik z laboratorium ({test})")
        imported += 1
        lab.acknowledge(code)
    db.commit()
    return LabSyncOut(imported=imported, skipped=skipped)
