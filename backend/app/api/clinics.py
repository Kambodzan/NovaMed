from uuid import UUID
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_roles
from app.core.db import get_db
from app.models import AppUser, Clinic, Doctor, Patient, PatientClinic, StaffClinic

router = APIRouter(prefix="/clinics", tags=["clinics"])

STAFF_MANAGERS = ("rejestracja", "kierownik", "administrator")


class ClinicIn(BaseModel):
    clinic_name: str = Field(min_length=1, max_length=100)
    address: str = Field(min_length=1, max_length=255)
    city: str | None = Field(default=None, max_length=60)
    lat: float | None = None
    lng: float | None = None
    photo_url: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=20)
    clinic_email: str | None = Field(default=None, max_length=100)


class ClinicOut(ClinicIn):
    clinic_id: UUID
    earlier_notice_min_hours: int = 24
    slot_interval_min: int = 15
    confirmation_required: bool = False
    confirmation_hours: int = 48


class ClinicSettingsIn(BaseModel):
    earlier_notice_min_hours: int = Field(ge=0, le=720, description="Min. wyprzedzenie [h] powiadomień o wcześniejszym terminie")
    slot_interval_min: int = Field(default=15, ge=5, le=120, description="Siatka terminów [min] — np. 15 lub 20")
    confirmation_required: bool = Field(default=False, description="Czy pacjent ma potwierdzać obecność przed wizytą")
    confirmation_hours: int = Field(default=48, ge=2, le=336, description="Ile godzin przed wizytą wysłać prośbę o potwierdzenie")


class StaffAssignIn(BaseModel):
    user_id: UUID
    start_date: date | None = None


class DoctorOut(BaseModel):
    doctor_id: UUID
    name: str
    specialization: str | None
    academic_title: str | None


class PatientAssignIn(BaseModel):
    patient_id: UUID


class PatientOut(BaseModel):
    patient_id: UUID
    first_name: str
    last_name: str
    pesel: str
    insurance_status: bool


def get_clinic_or_404(clinic_id: UUID, db: Session) -> Clinic:
    clinic = db.get(Clinic, clinic_id)
    if clinic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Placówka nie istnieje.")
    return clinic


@router.post("", status_code=status.HTTP_201_CREATED, response_model=ClinicOut)
def create_clinic(
    body: ClinicIn,
    _: AppUser = Depends(require_roles("administrator")),
    db: Session = Depends(get_db),
):
    clinic = Clinic(**body.model_dump())
    db.add(clinic)
    db.commit()
    return clinic_out(clinic)


def clinic_out(c: Clinic) -> ClinicOut:
    return ClinicOut(
        clinic_id=c.clinic_id, clinic_name=c.clinic_name, address=c.address,
        phone=c.phone, clinic_email=c.clinic_email, city=c.city, lat=c.lat, lng=c.lng,
        photo_url=c.photo_url,
        earlier_notice_min_hours=c.earlier_notice_min_hours,
        slot_interval_min=c.slot_interval_min,
        confirmation_required=c.confirmation_required,
        confirmation_hours=c.confirmation_hours,
    )


@router.get("", response_model=list[ClinicOut])
def list_clinics(db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    return [clinic_out(c) for c in db.scalars(select(Clinic).order_by(Clinic.clinic_name))]


@router.patch("/{clinic_id}/settings", response_model=ClinicOut)
def update_clinic_settings(
    clinic_id: UUID,
    body: ClinicSettingsIn,
    _: AppUser = Depends(require_roles("rejestracja", "kierownik", "administrator")),
    db: Session = Depends(get_db),
):
    """Ustawienia placówki — wyprzedzenie powiadomień, siatka terminów,
    potwierdzanie obecności przez pacjenta."""
    clinic = get_clinic_or_404(clinic_id, db)
    clinic.earlier_notice_min_hours = body.earlier_notice_min_hours
    clinic.slot_interval_min = body.slot_interval_min
    clinic.confirmation_required = body.confirmation_required
    clinic.confirmation_hours = body.confirmation_hours
    db.commit()
    return clinic_out(clinic)


@router.post("/{clinic_id}/staff", status_code=status.HTTP_201_CREATED)
def assign_staff(
    clinic_id: UUID,
    body: StaffAssignIn,
    _: AppUser = Depends(require_roles(*STAFF_MANAGERS)),
    db: Session = Depends(get_db),
):
    """UC-PP1: przypisanie pracownika (lekarz/pielęgniarka/rejestracja) do placówki."""
    get_clinic_or_404(clinic_id, db)
    if db.get(AppUser, body.user_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Użytkownik nie istnieje.")
    exists = db.scalar(select(StaffClinic).where(
        StaffClinic.clinic_id == clinic_id,
        StaffClinic.user_id == body.user_id,
        StaffClinic.end_date.is_(None),
    ))
    if exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Pracownik jest już przypisany do tej placówki.")
    db.add(StaffClinic(clinic_id=clinic_id, user_id=body.user_id, start_date=body.start_date or date.today()))
    db.commit()
    return {"status": "ok"}


@router.get("/{clinic_id}/doctors", response_model=list[DoctorOut])
def list_clinic_doctors(
    clinic_id: UUID,
    db: Session = Depends(get_db),
    _: AppUser = Depends(get_current_user),
):
    get_clinic_or_404(clinic_id, db)
    rows = db.execute(
        select(Doctor, AppUser)
        .join(AppUser, AppUser.user_id == Doctor.doctor_id)
        .join(StaffClinic, StaffClinic.user_id == Doctor.doctor_id)
        .where(StaffClinic.clinic_id == clinic_id, StaffClinic.end_date.is_(None))
    ).all()
    return [
        DoctorOut(
            doctor_id=d.doctor_id, name=u.username,
            specialization=d.specialization, academic_title=d.academic_title,
        )
        for d, u in rows
    ]


@router.post("/{clinic_id}/patients", status_code=status.HTTP_201_CREATED)
def assign_patient(
    clinic_id: UUID,
    body: PatientAssignIn,
    _: AppUser = Depends(require_roles(*STAFF_MANAGERS)),
    db: Session = Depends(get_db),
):
    """UC-PP3: przypisanie pacjenta do placówki."""
    get_clinic_or_404(clinic_id, db)
    if db.get(Patient, body.patient_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pacjent nie istnieje.")
    exists = db.scalar(select(PatientClinic).where(
        PatientClinic.clinic_id == clinic_id, PatientClinic.patient_id == body.patient_id,
    ))
    if exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Pacjent jest już przypisany do tej placówki.")
    db.add(PatientClinic(clinic_id=clinic_id, patient_id=body.patient_id, assigned_date=date.today()))
    db.commit()
    return {"status": "ok"}


@router.get("/{clinic_id}/patients", response_model=list[PatientOut])
def list_clinic_patients(
    clinic_id: UUID,
    _: AppUser = Depends(require_roles(*STAFF_MANAGERS, "lekarz", "pielegniarka")),
    db: Session = Depends(get_db),
):
    get_clinic_or_404(clinic_id, db)
    rows = db.scalars(
        select(Patient)
        .join(PatientClinic, PatientClinic.patient_id == Patient.patient_id)
        .where(PatientClinic.clinic_id == clinic_id)
        .order_by(Patient.last_name)
    )
    return [
        PatientOut(
            patient_id=p.patient_id, first_name=p.first_name, last_name=p.last_name,
            pesel=p.pesel, insurance_status=p.insurance_status,
        )
        for p in rows
    ]
