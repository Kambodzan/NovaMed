# Publiczne umawianie (M8.6): strona rezerwacji wystawiana przez klinikę
# BEZ logowania. Gość podaje dane → powstaje nieaktywny app_user + patient
# (jak podopieczny), wizyta CONFIRMED, potwierdzenie SMS-em. Po późniejszej
# rejestracji w Supabase tym samym e-mailem konto jest PRZEJMOWANE
# (auth.register_profile) razem z historią wizyt.
from uuid import UUID
import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.appointments import AppointmentOut, appointment_out, visit_label
from app.api.family import pesel_valid
from app.core.config import settings
from app.core.db import get_db
from app.domain.appointments import AppointmentStatus, AppointmentType
from app.domain.confirm import ensure_confirm_token
from app.domain.holds import acquire_hold, held_by, release_hold
from app.domain.notify import notify
from app.domain.otp import require_verified_phone, send_otp, verify_otp
from app.integrations.base import IntegrationError
from app.integrations.payments import PaymentsClient, get_payments_client
from app.models import Appointment, AppUser, Clinic, Patient, Payment, Review, Role

router = APIRouter(prefix="/public", tags=["public"])


class OtpSendIn(BaseModel):
    phone_number: str = Field(min_length=7, max_length=20)
    purpose: str = Field(pattern="^(BOOKING|REGISTRATION)$")


class OtpVerifyIn(OtpSendIn):
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


@router.post("/otp/send")
def otp_send(body: OtpSendIn, db: Session = Depends(get_db)):
    """Wysyła kod SMS na podany numer (rezerwacja publiczna / rejestracja).
    W DEV zwraca kod też w odpowiedzi — Twilio trial dostarcza tylko na numer
    zweryfikowany, więc demo z dowolnym numerem korzysta z tego fallbacku."""
    code = send_otp(db, body.phone_number, body.purpose)
    return {"sent": True, "dev_code": code if settings.dev_mode else None}


@router.post("/otp/verify")
def otp_verify(body: OtpVerifyIn, db: Session = Depends(get_db)):
    """Potwierdza kod — numer staje się „zweryfikowany" na czas dokończenia akcji."""
    verify_otp(db, body.phone_number, body.code, body.purpose)
    return {"verified": True}


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
    hold_token: str | None = None  # token miękkiej rezerwacji slotu (z /public/slots/{id}/hold)

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


class DoctorRatingOut(BaseModel):
    average: float | None
    count: int


@router.get("/doctors/{doctor_id}/rating", response_model=DoctorRatingOut)
def public_doctor_rating(doctor_id: UUID, db: Session = Depends(get_db)):
    """Średnia ocena lekarza (bez logowania) — lekki agregat do gwiazdki na karcie.
    Treść opinii pod /public/doctors/{id}/reviews (ładowane dopiero po rozwinięciu)."""
    avg = db.scalar(select(func.avg(Review.rating)).where(Review.doctor_id == doctor_id))
    count = db.scalar(select(func.count()).select_from(Review).where(Review.doctor_id == doctor_id)) or 0
    return DoctorRatingOut(average=round(float(avg), 2) if avg is not None else None, count=count)


class PublicReviewItem(BaseModel):
    rating: int
    comment: str | None
    created_at: datetime


class DoctorReviewsPublicOut(BaseModel):
    average: float | None
    count: int
    items: list[PublicReviewItem]


@router.get("/doctors/{doctor_id}/reviews", response_model=DoctorReviewsPublicOut)
def public_doctor_reviews(doctor_id: UUID, db: Session = Depends(get_db)):
    """Opinie o lekarzu (bez logowania) — ocena + treść, bez tożsamości oceniających.
    Najnowsze pierwsze. Karmi rozwijaną listę opinii na publicznej rezerwacji."""
    rows = db.scalars(
        select(Review).where(Review.doctor_id == doctor_id).order_by(Review.created_at.desc())
    ).all()
    avg = db.scalar(select(func.avg(Review.rating)).where(Review.doctor_id == doctor_id))
    return DoctorReviewsPublicOut(
        average=round(float(avg), 2) if avg is not None else None,
        count=len(rows),
        items=[PublicReviewItem(rating=r.rating, comment=r.comment, created_at=r.created_at) for r in rows],
    )


class HoldOut(BaseModel):
    hold_token: str
    expires_at: datetime


@router.post("/slots/{appointment_id}/hold", response_model=HoldOut)
def hold_slot(appointment_id: UUID, db: Session = Depends(get_db)):
    """Miękka rezerwacja terminu na czas wypełniania formularza (bez logowania).
    Pierwsza osoba, która wejdzie w slot, blokuje go dla pozostałych; pętla tła
    zwalnia porzucone holdy po slot_hold_minutes."""
    a = acquire_hold(db, appointment_id)
    db.commit()
    return HoldOut(hold_token=a.confirmation_token, expires_at=a.lock_expires_at)


@router.post("/slots/{appointment_id}/release")
def release_slot(appointment_id: UUID, hold_token: str = Query(...), db: Session = Depends(get_db)):
    """Zwolnienie miękkiej rezerwacji (np. „Zmień termin")."""
    released = release_hold(db, appointment_id, hold_token)
    db.commit()
    return {"released": released}


class GuestPaymentOut(BaseModel):
    amount: float
    provider_ref: str
    pay_token: str | None = None          # token do opłacenia z linku (przy rezerwacji płatnej)
    payment_status: str = "PENDING"       # PENDING / PAID / FAILED


class GuestBookOut(BaseModel):
    appointment: AppointmentOut
    payment: GuestPaymentOut | None = None  # ustawione dla wizyt płatnych — do opłacenia online


@router.post("/book", response_model=GuestBookOut)
def guest_book(
    body: GuestBookIn,
    db: Session = Depends(get_db),
    payments: PaymentsClient = Depends(get_payments_client),
):
    """Rezerwacja bez logowania. Wizyta bezpłatna (NFZ): FREE→CONFIRMED od razu.
    Wizyta płatna: FREE→TEMP_LOCK + płatność PENDING u operatora; gość opłaca ją
    online z linku (POST /public/visit/{token}/pay) — tak samo jak zalogowany pacjent,
    bez przymusu zakładania konta."""
    # blokada wiersza — serializuje równoczesne rezerwacje tego samego slotu
    a = db.get(Appointment, body.appointment_id, with_for_update=True)
    if a is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Termin nie istnieje.")
    # slot wolny ALBO trzymany przez TEGO klienta (hold z otwartego formularza)
    if a.appointment_status != AppointmentStatus.FREE.value and not held_by(a, body.hold_token):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ten termin nie jest już dostępny.")
    if a.appointment_datetime < datetime.now():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ten termin już minął — wybierz inny.")
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

    # numer musi być potwierdzony kodem SMS — dowód, że rezerwujący kontroluje
    # telefon (anty-spam; potwierdzenia/przypomnienia trafią pod realny numer)
    require_verified_phone(db, body.phone_number, "BOOKING")
    a.patient_id = guest.user_id
    a.lock_expires_at = None  # hold zamienia się w realną rezerwację (płatność/CONFIRMED)
    if body.reason:
        a.appointment_notes = body.reason.strip()[:500]
    if a.referral_required:
        a.external_referral = True

    if a.price is None:
        a.appointment_status = AppointmentStatus.CONFIRMED.value
        notify(db, guest.user_id, "Wizyta potwierdzona",
               f"Twoja rezerwacja: {visit_label(db, a)}. Załóż konto w NovaMed e-mailem {guest.email}, "
               "aby zarządzać wizytą online.")
        db.commit()
        return GuestBookOut(appointment=appointment_out(db, a))

    # wizyta płatna — slot zablokowany do czasu opłacenia (jak TEMP_LOCK pacjenta)
    a.appointment_status = AppointmentStatus.TEMP_LOCK.value
    token = ensure_confirm_token(a)
    try:
        provider_ref = payments.create_payment(
            amount=float(a.price), reference=f"appointment-{a.appointment_id}")
    except IntegrationError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=exc.message) from exc
    db.add(Payment(
        appointment_id=a.appointment_id, amount=a.price, payment_status="PENDING",
        provider_ref=provider_ref, created_at=datetime.now(),
    ))
    notify(db, guest.user_id, "Rezerwacja oczekuje na płatność",
           f"Zarezerwowaliśmy: {visit_label(db, a)}. Dokończ płatność {float(a.price):.2f} zł, aby potwierdzić wizytę.")
    db.commit()
    return GuestBookOut(
        appointment=appointment_out(db, a),
        payment=GuestPaymentOut(amount=float(a.price), provider_ref=provider_ref, pay_token=token),
    )


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


class GuestPayIn(BaseModel):
    outcome: str = Field(pattern="^(success|failure)$")


@router.post("/visit/{token}/pay", response_model=GuestBookOut)
def public_pay(
    token: str,
    body: GuestPayIn,
    db: Session = Depends(get_db),
    payments: PaymentsClient = Depends(get_payments_client),
):
    """Opłacenie rezerwacji gościa z linku (mock bramki: success/fail), bez logowania.
    Sukces: TEMP_LOCK→CONFIRMED. Odmowa: TEMP_LOCK→FREE — termin wraca do puli."""
    a = _by_token(token, db)
    if a.appointment_status != AppointmentStatus.TEMP_LOCK.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ta wizyta nie oczekuje na płatność.")
    payment = db.scalar(select(Payment).where(
        Payment.appointment_id == a.appointment_id, Payment.payment_status == "PENDING"))
    if payment is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Brak oczekującej płatności dla tej wizyty.")
    try:
        payments.confirm(provider_ref=payment.provider_ref, outcome=body.outcome)
        final = payments.get_status(provider_ref=payment.provider_ref)
    except IntegrationError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=exc.message) from exc

    if final == "PAID":
        payment.payment_status = "PAID"
        payment.paid_at = datetime.now()
        a.appointment_status = AppointmentStatus.CONFIRMED.value
        notify(db, a.patient_id, "Wizyta opłacona i potwierdzona",
               f"Płatność {float(payment.amount):.2f} zł zaksięgowana. Wizyta: {visit_label(db, a)}.")
        db.commit()
        return GuestBookOut(
            appointment=appointment_out(db, a),
            payment=GuestPaymentOut(amount=float(payment.amount), provider_ref=payment.provider_ref, payment_status="PAID"),
        )

    payment.payment_status = "FAILED"
    pid = a.patient_id
    a.appointment_status = AppointmentStatus.FREE.value
    a.patient_id = None
    a.confirmation_token = None
    a.lock_expires_at = None
    notify(db, pid, "Płatność odrzucona",
           "Operator odrzucił płatność. Termin wrócił do puli — spróbuj ponownie lub wybierz inny.")
    db.commit()
    return GuestBookOut(
        appointment=appointment_out(db, a),
        payment=GuestPaymentOut(amount=float(payment.amount), provider_ref=payment.provider_ref, payment_status="FAILED"),
    )
