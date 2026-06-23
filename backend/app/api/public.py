# Publiczne umawianie (M8.6): strona rezerwacji wystawiana przez klinikę
# BEZ logowania. Gość podaje dane → powstaje nieaktywny app_user + patient
# (jak podopieczny), wizyta CONFIRMED, potwierdzenie SMS-em. Po późniejszej
# rejestracji w Supabase tym samym e-mailem konto jest PRZEJMOWANE
# (auth.register_profile) razem z historią wizyt.
from uuid import UUID
import uuid
from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.appointments import (
    AppointmentOut,
    appointment_out,
    apply_p1_referral,
    notify_earlier_watchers,
    perform_reschedule,
    visit_label,
)
from app.integrations.p1 import P1Client, get_p1_client
from app.api.family import pesel_valid
from app.core.config import settings
from app.core.crypto import blind_index
from app.core.db import get_db
from app.domain.appointments import AppointmentStatus, AppointmentType
from app.domain.confirm import audience_links, confirm_link, ensure_confirm_token
from app.domain.coreservation import block_overlapping, restore_blocked
from app.domain.holds import acquire_hold, held_by, release_hold
from app.domain import messages
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
    p1_referral_code: str | None = Field(default=None, max_length=20)  # kod e-skierowania z P1
    # wizyta płatna: "online" (bramka — płatność jest dowodem realności, bez SMS) albo
    # "onsite" (rozliczenie w okienku — wtedy wymagamy potwierdzenia numeru kodem SMS)
    payment_mode: Literal["online", "onsite"] = "online"
    online: bool = False  # gość chce teleporadę (wideo) — tylko na slotach allow_online; zawsze płatna online
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
    p1: P1Client = Depends(get_p1_client),
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
    p1_code = body.p1_referral_code.strip() if body.p1_referral_code else None
    # walidacja skierowania PRZED efektami ubocznymi (zużycie kodu SMS, utworzenie gościa):
    # NFZ (termin bez ceny) — refundacja tylko z realnym e-skierowaniem w P1; papierowe
    # oświadczenie jej nie daje. Płatne — kod P1 albo oświadczenie do wyboru.
    if a.referral_required and not p1_code:
        if a.price is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="Na NFZ wymagane jest e-skierowanie (podaj kod z P1) — "
                                       "papierowe oświadczenie nie daje refundacji.")
        if not body.external_referral:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail=f"„{a.service_name}” wymaga skierowania — podaj kod e-skierowania z P1 albo zaznacz oświadczenie.")

    # gość: po PESEL-u — istniejące AKTYWNE konto → logowanie zamiast dubla
    patient = db.scalar(select(Patient).where(Patient.pesel_bidx == blind_index(body.pesel)))
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

    is_paid = a.price is not None
    # teleporada (wideo) tylko gdy slot na nią pozwala i jest płatna — bo jest ZAWSZE
    # płatna z góry online (na miejscu się nie da: pacjenta nie ma w placówce).
    is_online = body.online and a.allow_online and is_paid
    pay_online = is_paid and (body.payment_mode == "online" or is_online)
    # Numer potwierdzamy kodem SMS, gdy NIE płacimy online: NFZ i płatność na miejscu nie
    # mają bariery płatności, więc dowodem kontroli nad numerem (anty-spam) jest kod SMS.
    # Przy płatności online dowodem realności rezerwującego jest sama udana płatność.
    if not pay_online:
        require_verified_phone(db, body.phone_number, "BOOKING")
    a.patient_id = guest.user_id
    if is_online:
        a.appointment_type = AppointmentType.ONLINE.value  # teleporada — slot staje się wideo
    a.lock_expires_at = None  # hold zamienia się w realną rezerwację (płatność/CONFIRMED)
    if body.reason:
        a.appointment_notes = body.reason.strip()[:500]
    if a.referral_required:
        if p1_code:
            apply_p1_referral(db, p1, a, guest.user_id, p1_code)
        else:
            # tu dociera tylko slot płatny (NFZ bez kodu odrzucone w walidacji wyżej)
            a.external_referral = True

    if not pay_online:
        # NFZ (bezpłatna) albo płatność na miejscu — potwierdzamy wizytę od razu
        a.appointment_status = AppointmentStatus.CONFIRMED.value
        block_overlapping(db, a)
        if is_paid:  # płatność na miejscu — rozliczana w okienku placówki
            db.add(Payment(appointment_id=a.appointment_id, amount=a.price, payment_status="PAID",
                           provider_ref="NA_MIEJSCU", created_at=datetime.now(), paid_at=datetime.now()))
        join, manage = audience_links(db, a, online=False)  # ta gałąź to zawsze stacjonarna (online → płatność)
        notify(db, guest.user_id, *messages.visit_confirmed(
            visit_label(db, a), join_link=join, manage_link=manage,
            on_site_amount=float(a.price) if is_paid else None), email=True)
        db.commit()
        return GuestBookOut(
            appointment=appointment_out(db, a),
            payment=GuestPaymentOut(amount=float(a.price), provider_ref="NA_MIEJSCU", payment_status="PAID") if is_paid else None,
        )

    # płatność online — slot zablokowany do czasu opłacenia (TEMP_LOCK), bramka jak u pacjenta
    a.appointment_status = AppointmentStatus.TEMP_LOCK.value
    block_overlapping(db, a)
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
    # Brak powiadomienia "dokończ płatność": gość płaci od razu na ekranie rezerwacji,
    # a porzucony hold zwalnia sweep. Mail leci dopiero po udanej płatności (CONFIRMED).
    db.commit()
    return GuestBookOut(
        appointment=appointment_out(db, a),
        payment=GuestPaymentOut(amount=float(a.price), provider_ref=provider_ref, pay_token=token),
    )


# ---- potwierdzanie/odwołanie wizyty z linka SMS (bez logowania) ----

class VisitPublicOut(BaseModel):
    appointment_id: UUID
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
        appointment_id=a.appointment_id,
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
    restore_blocked(db, a)
    # termin wraca do puli jako nowy wolny slot (jeśli jeszcze przed czasem)
    if a.appointment_datetime > datetime.now():
        db.add(Appointment(
            patient_id=None, doctor_id=a.doctor_id, clinic_id=a.clinic_id,
            appointment_datetime=a.appointment_datetime, appointment_status=AppointmentStatus.FREE.value,
            appointment_type=a.appointment_type, allow_online=a.allow_online, price=a.price,
            service_name=a.service_name, referral_required=a.referral_required,
            service_id=a.service_id, duration_min=a.duration_min,
        ))
    pay = db.scalar(select(Payment).where(Payment.appointment_id == a.appointment_id, Payment.payment_status == "PAID"))
    refunded = False
    if pay is not None:
        pay.payment_status = "REFUNDED"
        refunded = True
    notify(db, patient_id, *messages.visit_cancelled(label, refunded=refunded), email=True)
    db.commit()
    return public_visit(token, db)


@router.get("/visit/{token}/slots", response_model=list[AppointmentOut])
def public_visit_slots(token: str, db: Session = Depends(get_db)):
    """Wolne terminy, na które gość może przełożyć wizytę z linka — ten sam
    lekarz/badanie, ta sama usługa i cena (backend i tak to wymusza)."""
    a = _by_token(token, db)
    if a.appointment_status != AppointmentStatus.CONFIRMED.value:
        return []
    q = select(Appointment).where(
        Appointment.appointment_status == AppointmentStatus.FREE.value,
        Appointment.appointment_datetime > datetime.now(),
        Appointment.appointment_id != a.appointment_id,
        Appointment.service_name == a.service_name,
    )
    q = q.where(Appointment.doctor_id == a.doctor_id) if a.doctor_id is not None \
        else q.where(Appointment.clinic_id == a.clinic_id, Appointment.doctor_id.is_(None))
    slots = sorted((s for s in db.scalars(q).all() if (s.price or 0) == (a.price or 0)),
                   key=lambda s: s.appointment_datetime)
    return [appointment_out(db, s) for s in slots]


class PublicRescheduleIn(BaseModel):
    new_appointment_id: UUID


@router.post("/visit/{token}/reschedule", response_model=VisitPublicOut)
def public_reschedule(token: str, body: PublicRescheduleIn, db: Session = Depends(get_db)):
    """Przełożenie wizyty z linka SMS (bez logowania). Link (token) wędruje na
    nowy termin, żeby gość dalej mógł nim zarządzać."""
    a = _by_token(token, db)
    if a.appointment_status != AppointmentStatus.CONFIRMED.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Tej wizyty nie można już przełożyć (odwołana lub odbyta).")
    new = db.get(Appointment, body.new_appointment_id)
    if new is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wybrany termin nie istnieje.")
    tok = a.confirmation_token
    a.confirmation_token = None
    db.flush()                    # zwolnij token w DB przed nadaniem go nowemu (unikat)
    perform_reschedule(db, a, new)
    new.confirmation_token = tok  # ten sam link działa dalej, wskazuje nowy termin
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
    Sukces: TEMP_LOCK→CONFIRMED. Odmowa: termin zostaje TEMP_LOCK (trzymany), a gość
    może spróbować ponownie z tego samego linku do końca okna blokady."""
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
        join, manage = audience_links(db, a, online=a.appointment_type == AppointmentType.ONLINE.value)
        notify(db, a.patient_id, *messages.visit_paid_confirmed(
            visit_label(db, a), float(payment.amount), join_link=join, manage_link=manage), email=True)
        db.commit()
        return GuestBookOut(
            appointment=appointment_out(db, a),
            payment=GuestPaymentOut(amount=float(payment.amount), provider_ref=payment.provider_ref, payment_status="PAID"),
        )

    # Odmowa NIE kasuje rezerwacji gościa: termin zostaje TEMP_LOCK (z linkiem/tokenem),
    # otwieramy nową próbę płatności (zachowany created_at → okno blokady bez zmian).
    payment.payment_status = "FAILED"
    try:
        retry_ref = payments.create_payment(
            amount=float(payment.amount), reference=f"appointment-{a.appointment_id}")
    except IntegrationError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=exc.message) from exc
    retry = Payment(
        appointment_id=a.appointment_id, amount=payment.amount,
        payment_status="PENDING", provider_ref=retry_ref, created_at=payment.created_at,
    )
    db.add(retry)
    db.flush()
    notify(db, a.patient_id, *messages.payment_declined(), sms=False)
    db.commit()
    return GuestBookOut(
        appointment=appointment_out(db, a),
        payment=GuestPaymentOut(amount=float(retry.amount), provider_ref=retry.provider_ref, payment_status="PENDING"),
    )


@router.post("/visit/{token}/cancel-payment", response_model=AppointmentOut)
def public_cancel_payment(token: str, db: Session = Depends(get_db)):
    """Gość rezygnuje z płatności (przycisk „wstecz") — zwalnia termin OD RAZU, bez
    czekania na upływ okna blokady. TEMP_LOCK→FREE, oczekująca płatność → FAILED."""
    a = _by_token(token, db)
    if a.appointment_status != AppointmentStatus.TEMP_LOCK.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ta wizyta nie oczekuje na płatność.")
    for p in db.scalars(select(Payment).where(
            Payment.appointment_id == a.appointment_id, Payment.payment_status == "PENDING")):
        p.payment_status = "FAILED"
    a.appointment_status = AppointmentStatus.FREE.value
    a.patient_id = None
    a.confirmation_token = None
    a.lock_expires_at = None
    restore_blocked(db, a)
    notify_earlier_watchers(db, doctor_id=a.doctor_id, clinic_id=a.clinic_id, slot_dts=[a.appointment_datetime])
    db.commit()
    return appointment_out(db, a)
