from uuid import UUID
import json
import secrets
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.family import allowed_patient_ids, resolve_patient_id
from app.core.auth import get_current_user, require_roles
from app.core.db import get_db
from app.domain.audit import log_access
from app.domain.documents import DocumentStatus, DocumentType, ReferralType
from app.domain.notify import notify
from app.domain.pdf import render_document_pdf
from app.integrations.base import IntegrationError
from app.integrations.ewus import EwusClient, get_ewus_client
from app.integrations.lab import LabClient, get_lab_client
from app.integrations.p1 import P1Client, get_p1_client
from app.integrations.zus import ZusClient, get_zus_client
from app.models import (
    Appointment, AppUser, Certificate, Doctor, LabResult, MedicalDocument, Patient,
    Prescription, Referral, SickLeave,
)

router = APIRouter(tags=["documents"])

STAFF_ROLES = ("lekarz", "pielegniarka", "rejestracja", "kierownik", "administrator")


# ---------- schematy ----------

class PrescriptionIn(BaseModel):
    appointment_id: UUID
    icd10: str = Field(min_length=3, max_length=10)
    drugs: str = Field(min_length=3)


class ReferralIn(BaseModel):
    appointment_id: UUID
    referral_type: ReferralType
    icd10: str = Field(min_length=3, max_length=10)
    notes: str | None = None


class SickLeaveIn(BaseModel):
    appointment_id: UUID
    date_from: date
    date_to: date
    indication: str = Field(default="chory powinien leżeć", max_length=255)

    @model_validator(mode="after")
    def validate_range(self):
        if self.date_to < self.date_from:
            raise ValueError("Data końca zwolnienia przed datą początku.")
        return self


class LabResultIn(BaseModel):
    appointment_id: UUID
    test_type: str = Field(min_length=2, max_length=100)
    test_description: str = Field(min_length=2)


class CertificateIn(BaseModel):
    appointment_id: UUID
    purpose: str = Field(min_length=2, max_length=200, description="Cel/przeznaczenie (np. do pracodawcy)")
    content: str = Field(min_length=2, description="Treść zaświadczenia — opis stanu zdrowia")
    valid_until: date | None = None


class DocumentOut(BaseModel):
    document_id: UUID
    document_type: str
    document_status: str
    issued_at: datetime
    patient_id: UUID
    patient_name: str
    doctor_name: str
    code: str | None = None
    details: str | None = None
    error_message: str | None = None
    referral_type: str | None = None  # NURSING/LAB/SPECIALIST (tylko skierowania)
    appointment_id: UUID | None = None  # wizyta, w której wystawiono dokument


# ---------- pomocnicze ----------

REFERRAL_TYPE_LABEL = {
    "NURSING": "zabieg pielęgniarski",
    "LAB": "badanie laboratoryjne",
    "SPECIALIST": "konsultacja specjalistyczna",
}


def document_out(db: Session, doc: MedicalDocument, error_message: str | None = None) -> DocumentOut:
    doctor_user = db.get(AppUser, doc.doctor_id)
    patient = db.get(Patient, doc.patient_id)
    code = None
    referral_type = None
    details = doc.document_content
    if doc.document_type == DocumentType.PRESCRIPTION.value:
        child = db.scalar(select(Prescription).where(Prescription.document_id == doc.document_id))
        if child:
            code, details = child.prescription_code, child.prescribed_drugs
    elif doc.document_type == DocumentType.REFERRAL.value:
        child = db.scalar(select(Referral).where(Referral.document_id == doc.document_id))
        if child:
            referral_type = child.referral_type
            label = REFERRAL_TYPE_LABEL.get(child.referral_type, child.referral_type)
            code, details = child.referral_code, f"{label}: {child.notes or ''}".strip(": ")
    elif doc.document_type == DocumentType.SICK_LEAVE.value:
        child = db.scalar(select(SickLeave).where(SickLeave.document_id == doc.document_id))
        if child:
            code = child.sick_leave_code
            details = f"od {child.start_date.isoformat()} do {child.end_date.isoformat()}"
    elif doc.document_type == DocumentType.LAB_RESULT.value:
        child = db.scalar(select(LabResult).where(LabResult.document_id == doc.document_id))
        if child:
            details = f"{child.test_type}: {child.test_description or ''}"
    elif doc.document_type == DocumentType.CERTIFICATE.value:
        child = db.scalar(select(Certificate).where(Certificate.document_id == doc.document_id))
        if child:
            code = child.certificate_code
            vu = f"\n\nWażne do: {child.valid_until.isoformat()}" if child.valid_until else ""
            details = f"Przeznaczenie: {child.purpose}\n\n{child.content}{vu}"
    return DocumentOut(
        document_id=doc.document_id,
        document_type=doc.document_type,
        document_status=doc.document_status,
        issued_at=doc.issued_at,
        patient_id=doc.patient_id,
        patient_name=f"{patient.first_name} {patient.last_name}",
        doctor_name=doctor_user.username,
        code=code,
        details=details,
        referral_type=referral_type,
        appointment_id=doc.appointment_id,
        error_message=error_message,
    )


def validate_visit(db: Session, doctor: AppUser, patient_id: UUID, appointment_id: UUID) -> Appointment:
    """Dokument zawsze powstaje w kontekście wizyty lekarza z TYM pacjentem."""
    if db.get(Patient, patient_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pacjent nie istnieje.")
    a = db.get(Appointment, appointment_id)
    if a is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wizyta nie istnieje.")
    if a.doctor_id != doctor.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="To nie jest wizyta tego lekarza.")
    if a.patient_id != patient_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Wizyta nie dotyczy tego pacjenta.")
    return a


def new_document(doctor_id: UUID, patient_id: UUID, appointment_id: UUID, doc_type: DocumentType,
                 doc_status: DocumentStatus, content: str | None = None) -> MedicalDocument:
    return MedicalDocument(
        appointment_id=appointment_id,
        patient_id=patient_id,
        doctor_id=doctor_id,
        issued_at=datetime.now(),
        document_type=doc_type.value,
        document_content=content,
        document_status=doc_status.value,
    )


def doctor_pwz(db: Session, doctor_id: UUID) -> str:
    return db.get(Doctor, doctor_id).license_number


DOC_LABELS = {
    DocumentType.PRESCRIPTION.value: "e-recepta",
    DocumentType.REFERRAL.value: "e-skierowanie",
    DocumentType.SICK_LEAVE.value: "e-zwolnienie (e-ZLA)",
    DocumentType.LAB_RESULT.value: "wynik badania",
    DocumentType.NOTE.value: "notatka z wizyty",
    DocumentType.CERTIFICATE.value: "zaświadczenie lekarskie",
}


def notify_new_document(db: Session, doc: MedicalDocument, code: str | None = None) -> None:
    """UC-P7: pacjent dostaje powiadomienie o każdym nowym dokumencie."""
    label = DOC_LABELS.get(doc.document_type, "dokument")
    extra = f" Kod: {code}." if code else ""
    notify(db, doc.patient_id, f"Nowy dokument: {label}",
           f"W Twojej dokumentacji pojawił się nowy dokument ({label}).{extra}")


# ---------- wystawianie (lekarz) ----------

@router.post("/patients/{patient_id}/prescriptions", status_code=status.HTTP_201_CREATED, response_model=DocumentOut)
def issue_prescription(
    patient_id: UUID,
    body: PrescriptionIn,
    user: AppUser = Depends(require_roles("lekarz")),
    db: Session = Depends(get_db),
    p1: P1Client = Depends(get_p1_client),
):
    """UC-L2 / diagramie stanów e-recepty. Błąd P1 → dokument zapisany lokalnie (ERROR),
    do ponownej wysyłki przez /documents/{id}/resend."""
    validate_visit(db, user, patient_id, body.appointment_id)
    patient = db.get(Patient, patient_id)
    payload = json.dumps(body.model_dump(exclude={"appointment_id"}), ensure_ascii=False)
    doc = new_document(user.user_id, patient_id, body.appointment_id,
                       DocumentType.PRESCRIPTION, DocumentStatus.SENT_TO_P1, payload)
    db.add(doc)
    db.flush()
    try:
        code = p1.issue_prescription(
            pesel=patient.pesel, doctor_pwz=doctor_pwz(db, user.user_id),
            icd10=body.icd10, drugs=body.drugs,
        )
    except IntegrationError as exc:
        doc.document_status = DocumentStatus.ERROR.value
        db.commit()
        return document_out(db, doc, error_message=exc.message)
    doc.document_status = DocumentStatus.CONFIRMED.value
    db.add(Prescription(document_id=doc.document_id, prescription_code=code, prescribed_drugs=body.drugs))
    notify_new_document(db, doc, code)
    db.commit()
    return document_out(db, doc)


@router.post("/patients/{patient_id}/referrals", status_code=status.HTTP_201_CREATED, response_model=DocumentOut)
def issue_referral(
    patient_id: UUID,
    body: ReferralIn,
    user: AppUser = Depends(require_roles("lekarz")),
    db: Session = Depends(get_db),
    p1: P1Client = Depends(get_p1_client),
    lab: LabClient = Depends(get_lab_client),
):
    """UC-L2/L4. NURSING = skierowanie wewnętrzne (od razu ACTIVE, własny kod,
    bez P1); LAB/SPECIALIST idą przez P1 jak e-skierowanie. Skierowanie LAB
    rejestruje też zlecenie w systemie laboratorium (UC-I2)."""
    validate_visit(db, user, patient_id, body.appointment_id)
    patient = db.get(Patient, patient_id)
    payload = json.dumps(body.model_dump(exclude={"appointment_id"}), ensure_ascii=False)

    if body.referral_type == ReferralType.NURSING:
        doc = new_document(user.user_id, patient_id, body.appointment_id,
                           DocumentType.REFERRAL, DocumentStatus.ACTIVE, payload)
        db.add(doc)
        db.flush()
        db.add(Referral(
            document_id=doc.document_id,
            referral_code=f"NUR-{secrets.token_hex(3).upper()}",
            referral_type=body.referral_type.value,
            notes=body.notes,
        ))
        notify_new_document(db, doc)
        db.commit()
        return document_out(db, doc)

    doc = new_document(user.user_id, patient_id, body.appointment_id,
                       DocumentType.REFERRAL, DocumentStatus.SENT_TO_P1, payload)
    db.add(doc)
    db.flush()
    try:
        code = p1.issue_referral(
            pesel=patient.pesel, doctor_pwz=doctor_pwz(db, user.user_id),
            icd10=body.icd10, referral_type=body.referral_type.value, notes=body.notes,
        )
    except IntegrationError as exc:
        doc.document_status = DocumentStatus.ERROR.value
        db.commit()
        return document_out(db, doc, error_message=exc.message)
    doc.document_status = DocumentStatus.CONFIRMED.value
    db.add(Referral(document_id=doc.document_id, referral_code=code,
                    referral_type=body.referral_type.value, notes=body.notes))
    notify_new_document(db, doc, code)
    db.commit()

    # rejestracja zlecenia w laboratorium (best-effort — wynik przyjdzie synchronizacją)
    lab_warning = None
    if body.referral_type == ReferralType.LAB:
        try:
            lab.create_order(
                pesel=patient.pesel, referral_code=code,
                test_type=(body.notes or "Badanie laboratoryjne")[:100],
            )
        except IntegrationError as exc:
            lab_warning = exc.message
    return document_out(db, doc, error_message=lab_warning)


@router.post("/patients/{patient_id}/sick-leaves", status_code=status.HTTP_201_CREATED, response_model=DocumentOut)
def issue_sick_leave(
    patient_id: UUID,
    body: SickLeaveIn,
    user: AppUser = Depends(require_roles("lekarz")),
    db: Session = Depends(get_db),
    zus: ZusClient = Depends(get_zus_client),
):
    """UC-L2 / sekwencji e-ZLA (ZUS)."""
    validate_visit(db, user, patient_id, body.appointment_id)
    patient = db.get(Patient, patient_id)
    payload = json.dumps(body.model_dump(exclude={"appointment_id"}, mode="json"), ensure_ascii=False)
    doc = new_document(user.user_id, patient_id, body.appointment_id,
                       DocumentType.SICK_LEAVE, DocumentStatus.SENT_TO_P1, payload)
    db.add(doc)
    db.flush()
    try:
        code = zus.issue_sick_leave(
            pesel=patient.pesel, doctor_pwz=doctor_pwz(db, user.user_id),
            date_from=body.date_from, date_to=body.date_to, indication=body.indication,
        )
    except IntegrationError as exc:
        doc.document_status = DocumentStatus.ERROR.value
        db.commit()
        return document_out(db, doc, error_message=exc.message)
    doc.document_status = DocumentStatus.SENT.value
    db.add(SickLeave(
        document_id=doc.document_id, sick_leave_code=code,
        start_date=body.date_from, end_date=body.date_to, sent_to_zus=True,
    ))
    notify_new_document(db, doc, code)
    db.commit()
    return document_out(db, doc)


@router.post("/patients/{patient_id}/lab-results", status_code=status.HTTP_201_CREATED, response_model=DocumentOut)
def add_lab_result(
    patient_id: UUID,
    body: LabResultIn,
    user: AppUser = Depends(require_roles("lekarz", "rejestracja", "kierownik")),
    db: Session = Depends(get_db),
):
    """UC-L1: wynik badania wykonanego na miejscu (lekarz, w kontekście swojej wizyty)
    + UC-PP3: rejestracja wpisuje wynik „z papieru" do dowolnej wizyty pacjenta."""
    if user.role.role_name == "lekarz":
        validate_visit(db, user, patient_id, body.appointment_id)
        author_id = user.user_id
    else:
        a = db.get(Appointment, body.appointment_id)
        if a is None or a.patient_id != patient_id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Wizyta nie dotyczy tego pacjenta.")
        if a.doctor_id is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="Wynik z papieru podpinaj do wizyty lekarskiej pacjenta.")
        author_id = a.doctor_id  # dokument podpisany lekarzem wizyty
    doc = new_document(author_id, patient_id, body.appointment_id,
                       DocumentType.LAB_RESULT, DocumentStatus.READY)
    db.add(doc)
    db.flush()
    db.add(LabResult(document_id=doc.document_id, test_type=body.test_type,
                     test_description=body.test_description))
    notify_new_document(db, doc)
    db.commit()
    return document_out(db, doc)


@router.post("/patients/{patient_id}/certificates", status_code=status.HTTP_201_CREATED, response_model=DocumentOut)
def issue_certificate(
    patient_id: UUID,
    body: CertificateIn,
    user: AppUser = Depends(require_roles("lekarz")),
    db: Session = Depends(get_db),
):
    """Zaświadczenie lekarskie o stanie zdrowia — dokument lokalny (nie P1/ZUS),
    z celem/przeznaczeniem i datą ważności; drukowany i wydawany pacjentowi."""
    validate_visit(db, user, patient_id, body.appointment_id)
    doc = new_document(user.user_id, patient_id, body.appointment_id,
                       DocumentType.CERTIFICATE, DocumentStatus.FINAL)
    db.add(doc)
    db.flush()
    code = f"ZAS-{secrets.token_hex(3).upper()}"
    db.add(Certificate(document_id=doc.document_id, certificate_code=code,
                       purpose=body.purpose.strip(), content=body.content.strip(),
                       valid_until=body.valid_until))
    notify_new_document(db, doc, code)
    db.commit()
    return document_out(db, doc)


@router.post("/documents/{document_id}/resend", response_model=DocumentOut)
def resend_document(
    document_id: UUID,
    user: AppUser = Depends(require_roles("lekarz")),
    db: Session = Depends(get_db),
    p1: P1Client = Depends(get_p1_client),
    zus: ZusClient = Depends(get_zus_client),
):
    """Ponowna wysyłka dokumentu po błędzie (ERROR → SENT_TO_P1 → CONFIRMED/SENT).
    Realizuje pętlę Error → Draft → SentToP1 z diagramu stanów e-recepty."""
    doc = db.get(MedicalDocument, document_id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dokument nie istnieje.")
    if doc.doctor_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="To nie jest dokument tego lekarza.")
    if doc.document_status != DocumentStatus.ERROR.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ponowna wysyłka możliwa tylko dla dokumentów z błędem.")

    patient = db.get(Patient, doc.patient_id)
    data = json.loads(doc.document_content or "{}")
    pwz = doctor_pwz(db, user.user_id)
    try:
        if doc.document_type == DocumentType.PRESCRIPTION.value:
            code = p1.issue_prescription(pesel=patient.pesel, doctor_pwz=pwz,
                                         icd10=data["icd10"], drugs=data["drugs"])
            db.add(Prescription(document_id=doc.document_id, prescription_code=code,
                                prescribed_drugs=data["drugs"]))
            doc.document_status = DocumentStatus.CONFIRMED.value
        elif doc.document_type == DocumentType.REFERRAL.value:
            code = p1.issue_referral(pesel=patient.pesel, doctor_pwz=pwz, icd10=data["icd10"],
                                     referral_type=data["referral_type"], notes=data.get("notes"))
            db.add(Referral(document_id=doc.document_id, referral_code=code,
                            referral_type=data["referral_type"], notes=data.get("notes")))
            doc.document_status = DocumentStatus.CONFIRMED.value
        elif doc.document_type == DocumentType.SICK_LEAVE.value:
            code = zus.issue_sick_leave(
                pesel=patient.pesel, doctor_pwz=pwz,
                date_from=date.fromisoformat(data["date_from"]),
                date_to=date.fromisoformat(data["date_to"]),
                indication=data.get("indication", ""),
            )
            db.add(SickLeave(document_id=doc.document_id, sick_leave_code=code,
                             start_date=date.fromisoformat(data["date_from"]),
                             end_date=date.fromisoformat(data["date_to"]), sent_to_zus=True))
            doc.document_status = DocumentStatus.SENT.value
        else:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ten typ dokumentu nie podlega wysyłce.")
    except IntegrationError as exc:
        db.commit()
        return document_out(db, doc, error_message=exc.message)
    db.commit()
    return document_out(db, doc)


# ---------- wgląd ----------

class PatientInfoOut(BaseModel):
    patient_id: UUID
    first_name: str
    last_name: str
    pesel: str
    birth_date: date
    insurance_status: bool
    phone_number: str | None
    # konta rodzinne: podopieczny zwykle nie ma telefonu — kontakt przez opiekuna
    guardian_name: str | None = None
    guardian_phone: str | None = None


def patient_info_out(db: Session, p: Patient) -> PatientInfoOut:
    user = db.get(AppUser, p.patient_id)
    guardian = db.get(AppUser, p.guardian_id) if p.guardian_id else None
    return PatientInfoOut(
        patient_id=p.patient_id, first_name=p.first_name, last_name=p.last_name,
        pesel=p.pesel, birth_date=p.birth_date, insurance_status=p.insurance_status,
        phone_number=user.phone_number,
        guardian_name=guardian.username if guardian else None,
        guardian_phone=guardian.phone_number if guardian else None,
    )


@router.get("/patients/{patient_id}", response_model=PatientInfoOut)
def patient_info(
    patient_id: UUID,
    user: AppUser = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
):
    """Nagłówek karty pacjenta dla personelu (UC-L1, UC-N1)."""
    p = db.get(Patient, patient_id)
    if p is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pacjent nie istnieje.")
    log_access(db, actor=user, action="VIEW_RECORD", patient_id=patient_id)
    return patient_info_out(db, p)


class PatientContactIn(BaseModel):
    phone_number: str | None = Field(default=None, max_length=20)
    first_name: str | None = Field(default=None, min_length=1, max_length=50)
    last_name: str | None = Field(default=None, min_length=1, max_length=50)


@router.patch("/patients/{patient_id}/contact", response_model=PatientInfoOut)
def update_patient_contact(
    patient_id: UUID,
    body: PatientContactIn,
    _: AppUser = Depends(require_roles("rejestracja", "kierownik", "administrator")),
    db: Session = Depends(get_db),
):
    """UC-PP3: edycja danych kontaktowych pacjenta przez rejestrację."""
    p = db.get(Patient, patient_id)
    if p is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pacjent nie istnieje.")
    user = db.get(AppUser, patient_id)
    if body.phone_number is not None:
        user.phone_number = body.phone_number.strip() or None
    if body.first_name:
        p.first_name = body.first_name
    if body.last_name:
        p.last_name = body.last_name
    user.username = f"{p.first_name} {p.last_name}"
    db.commit()
    return patient_info_out(db, p)


@router.post("/patients/{patient_id}/verify-insurance", response_model=PatientInfoOut)
def verify_insurance(
    patient_id: UUID,
    user: AppUser = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
    ewus: EwusClient = Depends(get_ewus_client),
):
    """UC-I4 / sekwencji eWUŚ: ręczna weryfikacja ubezpieczenia przez personel."""
    p = db.get(Patient, patient_id)
    if p is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pacjent nie istnieje.")
    try:
        p.insurance_status = ewus.verify(pesel=p.pesel)
    except IntegrationError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=exc.message) from exc
    db.commit()
    return patient_info_out(db, p)


class HistoryDocOut(BaseModel):
    label: str
    code: str | None
    details: str | None


class HistoryEntryOut(BaseModel):
    appointment_id: UUID
    date: datetime
    doctor_name: str
    appointment_type: str
    note: str | None = None
    addenda: list[str] = []
    documents: list[HistoryDocOut] = []


def _start_of_tomorrow() -> datetime:
    """Północ jutro — granica „data slotu ≤ dziś" dla historii wizyt."""
    return (datetime.now() + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)


@router.get("/patients/{patient_id}/history", response_model=list[HistoryEntryOut])
def patient_history(
    patient_id: UUID,
    user: AppUser = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
):
    """Historia wizyt pacjenta z notami i wystawionymi dokumentami (UC-L1) —
    ciągłość leczenia: co było, co rozpoznano, co zalecono. Najważniejszy
    kontekst dla lekarza, ważniejszy niż płaska lista dokumentów."""
    from app.models import ClinicalNote  # import lokalny

    if db.get(Patient, patient_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pacjent nie istnieje.")
    log_access(db, actor=user, action="VIEW_RECORD", patient_id=patient_id, detail="historia wizyt")

    visits = db.scalars(
        select(Appointment).where(
            Appointment.patient_id == patient_id,
            Appointment.doctor_id.is_not(None),
            Appointment.appointment_status == "COMPLETED",
            # odsiewa artefakty danych testowych (smoke kończy wizyty 40+ dni
            # naprzód), ale ZACHOWUJE dzisiejsze — slot bywa później niż realne
            # zakończenie, więc filtrujemy po dacie (≤ dziś), nie po godzinie
            Appointment.appointment_datetime < _start_of_tomorrow(),
        ).order_by(Appointment.appointment_datetime.desc())
    ).all()

    out: list[HistoryEntryOut] = []
    for a in visits:
        doc_user = db.get(AppUser, a.doctor_id)
        note = db.scalar(select(ClinicalNote).where(
            ClinicalNote.appointment_id == a.appointment_id, ClinicalNote.status == "SIGNED"))
        docs = db.scalars(select(MedicalDocument).where(
            MedicalDocument.appointment_id == a.appointment_id)
            .order_by(MedicalDocument.issued_at)).all()
        entries = []
        for d in docs:
            o = document_out(db, d)
            entries.append(HistoryDocOut(label=DOC_LABELS.get(d.document_type, d.document_type),
                                         code=o.code, details=o.details))
        out.append(HistoryEntryOut(
            appointment_id=a.appointment_id, date=a.appointment_datetime,
            doctor_name=doc_user.username if doc_user else "—",
            appointment_type=a.appointment_type,
            note=note.content if note else None,
            addenda=[ad.content for ad in note.addenda] if note else [],
            documents=entries,
        ))
    return out


@router.get("/patients/{patient_id}/documents", response_model=list[DocumentOut])
def patient_documents(
    patient_id: UUID,
    user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """UC-P4 (pacjent — własne i podopiecznych) / UC-L1, UC-N1 (personel)."""
    if user.role.role_name == "pacjent" and patient_id not in allowed_patient_ids(db, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Brak dostępu do dokumentacji innego pacjenta.")
    if user.role.role_name != "pacjent" and user.role.role_name not in STAFF_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Brak uprawnień.")
    if user.role.role_name != "pacjent":
        log_access(db, actor=user, action="VIEW_DOCUMENTS", patient_id=patient_id)
    rows = db.scalars(
        select(MedicalDocument)
        .where(MedicalDocument.patient_id == patient_id)
        .order_by(MedicalDocument.issued_at.desc())
    )
    return [document_out(db, d) for d in rows]


@router.get("/documents/my", response_model=list[DocumentOut])
def my_documents(
    as_patient: UUID | None = Query(default=None),
    user: AppUser = Depends(require_roles("pacjent")),
    db: Session = Depends(get_db),
):
    patient_id = resolve_patient_id(db, user, as_patient)
    rows = db.scalars(
        select(MedicalDocument)
        .where(MedicalDocument.patient_id == patient_id)
        .order_by(MedicalDocument.issued_at.desc())
    )
    return [document_out(db, d) for d in rows]


@router.get("/documents/issued", response_model=list[DocumentOut])
def issued_documents(
    user: AppUser = Depends(require_roles("lekarz")),
    db: Session = Depends(get_db),
):
    """Dokumenty wystawione przez zalogowanego lekarza (rejestr własnej pracy)."""
    rows = db.scalars(
        select(MedicalDocument)
        .where(MedicalDocument.doctor_id == user.user_id)
        .order_by(MedicalDocument.issued_at.desc())
        .limit(500)
    )
    return [document_out(db, d) for d in rows]


@router.get("/documents/{document_id}/pdf")
def document_pdf(
    document_id: UUID,
    user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """UC-P4: pobranie dokumentu jako PDF (pacjent — własne; personel — wszystkie)."""
    doc = db.get(MedicalDocument, document_id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dokument nie istnieje.")
    role = user.role.role_name
    if role == "pacjent":
        if doc.patient_id not in allowed_patient_ids(db, user):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Brak dostępu do dokumentu innego pacjenta.")
    elif role not in STAFF_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Brak uprawnień.")
    if role != "pacjent":
        log_access(db, actor=user, action="DOWNLOAD_PDF", patient_id=doc.patient_id,
                   detail=DOC_LABELS.get(doc.document_type, doc.document_type))

    out = document_out(db, doc)
    patient = db.get(Patient, doc.patient_id)
    pdf = render_document_pdf(
        doc_label=DOC_LABELS.get(doc.document_type, "dokument").capitalize(),
        patient_name=out.patient_name,
        pesel=patient.pesel,
        doctor_name=out.doctor_name,
        issued_at=doc.issued_at.strftime("%d.%m.%Y %H:%M"),
        status_label=doc.document_status,
        code=out.code,
        details=out.details,
    )
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="novamed-dokument-{doc.document_id}.pdf"'},
    )


@router.get("/referrals/nursing", response_model=list[DocumentOut])
def nursing_referrals(
    _: AppUser = Depends(require_roles("pielegniarka")),
    db: Session = Depends(get_db),
):
    """UC-L4→UC-N2: skierowania na zabiegi pielęgniarskie czekające na zaplanowanie.
    Skierowanie z zaplanowanym (nieodwołanym) zabiegiem znika z kolejki;
    po odwołaniu zabiegu wraca."""
    from app.models import NursingProcedure  # import lokalny — unika cyklu

    active_procedure = (
        select(NursingProcedure.procedure_id)
        .where(
            NursingProcedure.referral_id == Referral.referral_id,
            NursingProcedure.procedure_status != "CANCELLED",
        )
        .exists()
    )
    rows = db.scalars(
        select(MedicalDocument)
        .join(Referral, Referral.document_id == MedicalDocument.document_id)
        .where(
            Referral.referral_type == ReferralType.NURSING.value,
            MedicalDocument.document_status == DocumentStatus.ACTIVE.value,
            ~active_procedure,
        )
        .order_by(MedicalDocument.issued_at)
    )
    return [document_out(db, d) for d in rows]
