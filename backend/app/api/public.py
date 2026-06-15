# Publiczne umawianie (M8.6): strona rezerwacji wystawiana przez klinikę
# BEZ logowania. Gość podaje dane → powstaje nieaktywny app_user + patient
# (jak podopieczny), wizyta CONFIRMED, potwierdzenie SMS-em. Po późniejszej
# rejestracji w Supabase tym samym e-mailem konto jest PRZEJMOWANE
# (auth.register_profile) razem z historią wizyt.
from uuid import UUID
import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.appointments import AppointmentOut, appointment_out, get_appointment_or_404, visit_label
from app.api.family import pesel_valid
from app.core.db import get_db
from app.domain.appointments import AppointmentStatus, AppointmentType
from app.domain.notify import notify
from app.models import Appointment, AppUser, Clinic, Patient, Payment, Role

router = APIRouter(prefix="/public", tags=["public"])


class PublicClinicOut(BaseModel):
    clinic_id: UUID
    clinic_name: str
    address: str
    city: str | None
    lat: float | None
    lng: float | None
    photo_url: str | None


class GuestBookIn(BaseModel):
    appointment_id: UUID
    first_name: str = Field(min_length=1, max_length=50)
    last_name: str = Field(min_length=1, max_length=50)
    pesel: str = Field(min_length=11, max_length=11, pattern=r"^\d{11}$")
    birth_date: date
    phone_number: str = Field(min_length=7, max_length=20)
    email: EmailStr
    reason: str | None = Field(default=None, max_length=500)
    external_referral: bool = False

    @field_validator("pesel")
    @classmethod
    def check_pesel(cls, v: str) -> str:
        if not pesel_valid(v):
            raise ValueError("Nieprawidłowy numer PESEL (błędna suma kontrolna).")
        return v


@router.get("/clinics", response_model=list[PublicClinicOut])
def public_clinics(db: Session = Depends(get_db)):
    return [
        PublicClinicOut(clinic_id=c.clinic_id, clinic_name=c.clinic_name, address=c.address,
                        city=c.city, lat=c.lat, lng=c.lng, photo_url=c.photo_url)
        for c in db.scalars(select(Clinic).order_by(Clinic.clinic_name))
    ]


@router.get("/slots", response_model=list[AppointmentOut])
def public_slots(db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Appointment)
        .where(Appointment.appointment_status == AppointmentStatus.FREE.value,
               Appointment.appointment_datetime > datetime.now())
        .order_by(Appointment.appointment_datetime)
    )
    return [appointment_out(db, a) for a in rows]


@router.post("/book", response_model=AppointmentOut)
def guest_book(body: GuestBookIn, db: Session = Depends(get_db)):
    a = get_appointment_or_404(body.appointment_id, db)
    if a.appointment_status != AppointmentStatus.FREE.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ten termin nie jest już dostępny.")
    if a.appointment_datetime < datetime.now():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ten termin już minął — wybierz inny.")
    if a.price is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Terminy płatne rezerwuje się po zalogowaniu (płatność online). Załóż konto.")
    if a.referral_required and not body.external_referral:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"Badanie „{a.service_name}” na NFZ wymaga skierowania — zaznacz oświadczenie.")

    # gość: po PESEL-u — istniejące AKTYWNE konto → logowanie zamiast dubla
    patient = db.scalar(select(Patient).where(Patient.pesel == body.pesel))
    if patient:
        owner = db.get(AppUser, patient.patient_id)
        if owner.active_account:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="Masz już konto w NovaMed — zaloguj się, aby zarezerwować.")
        guest = owner
        guest.phone_number = body.phone_number
    else:
        role = db.scalar(select(Role).where(Role.role_name == "pacjent"))
        guest = AppUser(
            role_id=role.role_id, supabase_uid=uuid.uuid4(),
            username=f"{body.first_name} {body.last_name}",
            email=str(body.email).lower(), phone_number=body.phone_number,
            active_account=False,  # konto-gość; do przejęcia przy rejestracji
        )
        db.add(guest)
        db.flush()
        db.add(Patient(
            patient_id=guest.user_id, first_name=body.first_name, last_name=body.last_name,
            pesel=body.pesel, birth_date=body.birth_date,
        ))

    a.patient_id = guest.user_id
    a.appointment_status = AppointmentStatus.CONFIRMED.value
    if body.reason:
        a.appointment_notes = body.reason.strip()[:500]
    if a.referral_required:
        a.external_referral = True
    notify(db, guest.user_id, "Wizyta potwierdzona",
           f"Twoja rezerwacja: {visit_label(db, a)}. Załóż konto w NovaMed e-mailem {guest.email}, "
           "aby zarządzać wizytą online.")
    db.commit()
    return appointment_out(db, a)


# ---- potwierdzanie/odwołanie wizyty z linka SMS (bez logowania) ----

class VisitPublicOut(BaseModel):
    patient_name: str
    doctor_name: str
    clinic_name: str
    address: str | None
    appointment_datetime: datetime
    online: bool
    status: str
    confirmed: bool


def _by_token(token: str, db: Session) -> Appointment:
    a = db.scalar(select(Appointment).where(Appointment.confirmation_token == token))
    if a is None or a.patient_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link jest nieprawidłowy lub wygasł.")
    return a


@router.get("/visit/{token}", response_model=VisitPublicOut)
def public_visit(token: str, db: Session = Depends(get_db)):
    """Podgląd wizyty z linka SMS (do potwierdzenia/odwołania bez logowania)."""
    a = _by_token(token, db)
    patient = db.get(Patient, a.patient_id)
    doctor_user = db.get(AppUser, a.doctor_id) if a.doctor_id else None
    clinic = db.get(Clinic, a.clinic_id)
    online = a.appointment_type == AppointmentType.ONLINE.value
    return VisitPublicOut(
        patient_name=f"{patient.first_name} {patient.last_name}",
        doctor_name=doctor_user.username if doctor_user else (a.service_name or "Pracownia"),
        clinic_name=clinic.clinic_name,
        address=None if online else clinic.address,
        appointment_datetime=a.appointment_datetime,
        online=online,
        status=a.appointment_status,
        confirmed=a.patient_confirmed,
    )


@router.post("/visit/{token}/confirm", response_model=VisitPublicOut)
def public_confirm(token: str, db: Session = Depends(get_db)):
    a = _by_token(token, db)
    if a.appointment_status != AppointmentStatus.CONFIRMED.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Tej wizyty nie można już potwierdzić (odwołana lub odbyta).")
    a.patient_confirmed = True
    db.commit()
    return public_visit(token, db)


@router.post("/visit/{token}/cancel", response_model=VisitPublicOut)
def public_cancel(token: str, db: Session = Depends(get_db)):
    a = _by_token(token, db)
    if a.appointment_status != AppointmentStatus.CONFIRMED.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Tej wizyty nie można już odwołać.")
    label = visit_label(db, a)
    patient_id = a.patient_id
    a.appointment_status = AppointmentStatus.CANCELLED.value
    # termin wraca do puli jako nowy wolny slot (jeśli jeszcze przed czasem)
    if a.appointment_datetime > datetime.now():
        db.add(Appointment(
            patient_id=None, doctor_id=a.doctor_id, clinic_id=a.clinic_id,
            appointment_datetime=a.appointment_datetime, appointment_status=AppointmentStatus.FREE.value,
            appointment_type=a.appointment_type, allow_online=a.allow_online, price=a.price,
            service_name=a.service_name, referral_required=a.referral_required,
        ))
    pay = db.scalar(select(Payment).where(Payment.appointment_id == a.appointment_id, Payment.payment_status == "PAID"))
    refunded = False
    if pay is not None:
        pay.payment_status = "REFUNDED"
        refunded = True
    notify(db, patient_id, "Wizyta odwołana",
           f"Odwołałeś wizytę: {label}." + (" Zwrot opłaty nastąpi tą samą metodą." if refunded else ""))
    db.commit()
    return public_visit(token, db)
