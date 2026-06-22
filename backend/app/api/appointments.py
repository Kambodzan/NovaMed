from uuid import UUID
import uuid
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.family import allowed_patient_ids, pesel_valid, resolve_patient_id
from app.core.auth import get_current_user, require_roles
from app.domain.confirm import audience_links, confirm_link, ensure_confirm_token
from app.domain.coreservation import block_overlapping, restore_blocked
from app.domain.holds import acquire_hold, held_by, release_hold
from app.domain.tenancy import assert_staff_can_access_patient, assert_staff_in_clinic
from app.core.config import settings
from app.core.db import get_db
from app.domain.appointments import (
    CANCEL_MIN_HOURS,
    AppointmentStatus,
    AppointmentType,
    assert_transition,
)
from app.domain import messages
from app.domain.notify import notify
from app.domain.referrals import consume_p1_referral, verify_p1_referral
from app.integrations.base import IntegrationError
from app.integrations.ewus import EwusClient, get_ewus_client
from app.integrations.p1 import P1Client, get_p1_client
from app.integrations.payments import PaymentsClient, get_payments_client
from app.models import (
    Appointment, AppUser, Clinic, Doctor, DoctorService, DoctorSpecialization, Patient, Payment, Role,
    Service, StaffClinic, WaitingListEntry,
)

# role, które mogą umawiać w imieniu pacjenta (rejestracja/okienko/telefon)
RECEPTION_ROLES = ("rejestracja", "kierownik", "administrator")


def visit_label(db: Session, a: Appointment) -> str:
    when = a.appointment_datetime.strftime('%d.%m.%Y %H:%M')
    if a.doctor_id is None:  # badanie — pracownia placówki
        clinic = db.get(Clinic, a.clinic_id)
        return f"{a.service_name}, {clinic.clinic_name}, {when}"
    doctor_user = db.get(AppUser, a.doctor_id)
    return f"{doctor_user.username}, {when}"


def notify_earlier_watchers(db: Session, *, doctor_id: UUID, clinic_id: UUID, slot_dts: list[datetime]) -> set[UUID]:
    """Sloty stały się wolne → powiadom pacjentów z PÓŹNIEJSZĄ wizytą u tego lekarza,
    którzy zaznaczyli notify_earlier. Limit placówki (earlier_notice_min_hours)
    chroni przed powiadomieniami o terminach „za 2 godziny". Cała paczka slotów
    (np. seria cykliczna ×12) = JEDNO powiadomienie per pacjent, nie 12.
    Zwraca zbiór powiadomionych pacjentów (do dedupu z listą oczekujących)."""
    clinic = db.get(Clinic, clinic_id)
    min_hours = clinic.earlier_notice_min_hours if clinic else 24
    cutoff = datetime.now() + timedelta(hours=min_hours)
    eligible = sorted(dt for dt in slot_dts if dt >= cutoff)
    if not eligible:
        return set()
    doctor_user = db.get(AppUser, doctor_id)
    watchers = db.scalars(select(Appointment).where(
        Appointment.doctor_id == doctor_id,
        Appointment.appointment_status == AppointmentStatus.CONFIRMED.value,
        Appointment.notify_earlier.is_(True),
        Appointment.patient_id.is_not(None),
        Appointment.appointment_datetime > eligible[0],
    )).all()
    seen: set[UUID] = set()
    for w in watchers:
        if w.patient_id in seen:
            continue
        mine = [dt for dt in eligible if dt < w.appointment_datetime]
        if not mine:
            continue
        seen.add(w.patient_id)
        extra = f" i {len(mine) - 1} kolejnych" if len(mine) > 1 else ""
        notify(
            db, w.patient_id,
            "Zwolnił się wcześniejszy termin",
            f"U {doctor_user.username} zwolnił się termin {mine[0].strftime('%d.%m.%Y %H:%M')}{extra} — "
            f"wcześniej niż Twoja wizyta ({w.appointment_datetime.strftime('%d.%m %H:%M')}). "
            "Jeśli Ci pasuje, wejdź w Moje wizyty → Zmień termin (do 24 h przed wizytą, terminy bezpłatne).",
        )
    return seen


def notify_waitlist(db: Session, specializations, *, freed: bool = False,
                    exclude: set[UUID] | None = None) -> None:
    """Powiadom listę oczekujących na KTÓRĄKOLWIEK ze specjalizacji lekarza
    o nowym/zwolnionym terminie i zdejmij ich z listy. Tytuł zaczyna się od
    „Nowe terminy" / „Wolny termin" — dzwonek robi z tego deep-link do „Umów
    wizytę" (UC-P3 A1). `specializations` może być stringiem albo listą."""
    if isinstance(specializations, str):
        specializations = [specializations]
    specializations = [s for s in (specializations or []) if s]
    if not specializations:
        return
    exclude = exclude or set()
    entries = db.scalars(select(WaitingListEntry).where(
        WaitingListEntry.specialization.in_(specializations))).all()
    for entry in entries:
        if entry.patient_id in exclude:  # już powiadomiony jako „wcześniejszy termin"
            continue
        if freed:
            notify(db, entry.patient_id, "Wolny termin — koniec oczekiwania",
                   f"Zwolnił się termin: {entry.specialization}. Zarezerwuj go w zakładce „Umów wizytę”.")
        else:
            notify(db, entry.patient_id, "Nowe terminy — koniec oczekiwania",
                   f"Pojawiły się nowe terminy: {entry.specialization}. Zarezerwuj wizytę w zakładce „Umów wizytę”.")
        db.delete(entry)


router = APIRouter(tags=["appointments"])

SLOT_MANAGERS = ("lekarz", "rejestracja", "kierownik", "administrator")


class SlotsCreateIn(BaseModel):
    # wizyta lekarska: doctor_id; badanie (pracownia placówki): service_name [+ referral_required]
    doctor_id: UUID | None = None
    service_name: str | None = Field(default=None, max_length=100)
    # usługa z katalogu (typ wizyty/przyjęcia): nazwa/cena/czas/skierowanie z usługi.
    # Może iść razem z doctor_id (lekarz wykonuje usługę)
    service_id: UUID | None = None
    referral_required: bool = False
    datetimes: list[datetime]
    appointment_type: AppointmentType = AppointmentType.STATIONARY
    allow_online: bool = True  # slot STATIONARY: czy pacjent może wybrać teleporadę
    price: float | None = Field(default=None, ge=0, description="Cena wizyty prywatnej; brak = NFZ/bezpłatna")


class AppointmentOut(BaseModel):
    appointment_id: UUID
    appointment_datetime: datetime
    appointment_status: str
    appointment_type: str
    allow_online: bool = True  # czy wizytę stacjonarną można wykonać jako teleporadę
    doctor_id: UUID | None
    doctor_name: str
    specializations: list[str] = []
    clinic_id: UUID
    clinic_name: str
    clinic_address: str | None = None  # do legendy „cała sieć" w Grafiku recepcji
    clinic_city: str | None = None
    patient_id: UUID | None = None
    patient_name: str | None = None
    price: float | None = None
    reviewed: bool | None = None  # tylko w /appointments/my (UC-P8)
    notes: str | None = None      # powód wizyty („co Ci dolega") podany przy rezerwacji
    notify_earlier: bool = False
    service_name: str | None = None     # nazwa usługi/badania (NULL = zwykła wizyta lekarska)
    service_id: UUID | None = None       # usługa z katalogu (typ wizyty/przyjęcia)
    duration_min: int | None = None      # czas trwania [min] (z usługi)
    referral_required: bool = False
    # potwierdzanie obecności (gdy placówka wymaga)
    confirmation_requested: bool = False
    patient_confirmed: bool = False
    # płatność: do kiedy slot jest zablokowany (TEMP_LOCK) + status rozliczenia
    locked_until: datetime | None = None
    payment_status: str | None = None  # PENDING/PAID/FAILED/REFUNDED (wizyty płatne)
    # meldowanie przez recepcję: pacjent czeka (od kiedy) + przydzielony gabinet
    checked_in_at: datetime | None = None
    room: str | None = None


class PaymentInfoOut(BaseModel):
    payment_id: UUID
    provider_ref: str
    amount: float
    payment_status: str


class BookOut(BaseModel):
    appointment: AppointmentOut
    payment: PaymentInfoOut | None = None


class PayIn(BaseModel):
    outcome: str = Field(pattern="^(success|failure)$", description="Symulacja autoryzacji u operatora (mock)")


class BookIn(BaseModel):
    reason: str | None = Field(default=None, max_length=500, description="Powód wizyty (opcjonalnie)")
    notify_earlier: bool = Field(default=False, description="Powiadom, gdy zwolni się wcześniejszy termin")
    # teleporada to WYBÓR PACJENTA przy rezerwacji, nie cecha slotu
    online: bool = Field(default=False, description="Pacjent woli teleporadę (wizyta online)")
    # skierowanie: nasze z apki / kod e-skierowania z P1 (NFZ) / oświadczenie o zewnętrznym
    referral_document_id: UUID | None = None
    p1_referral_code: str | None = Field(default=None, max_length=20)
    external_referral: bool = False
    # wizyta płatna: zapłać online (TEMP_LOCK→bramka) albo na miejscu (CONFIRMED od razu,
    # rozliczenie w okienku). NFZ ignoruje to pole (bezpłatna).
    pay_on_site: bool = Field(default=False, description="Płatna wizyta: rozliczenie na miejscu zamiast online")
    hold_token: str | None = None  # token miękkiej rezerwacji slotu (z /appointments/{id}/hold)


class RescheduleIn(BaseModel):
    new_appointment_id: UUID


class StatusChangeIn(BaseModel):
    new_status: AppointmentStatus


def appointment_out(db: Session, a: Appointment) -> AppointmentOut:
    doctor_user = db.get(AppUser, a.doctor_id) if a.doctor_id else None
    doctor = db.get(Doctor, a.doctor_id) if a.doctor_id else None
    clinic = db.get(Clinic, a.clinic_id)
    patient = db.get(Patient, a.patient_id) if a.patient_id else None
    # płatność liczymy tylko gdy może istnieć (TEMP_LOCK lub wizyta płatna) —
    # bez dodatkowego zapytania dla zwykłych terminów NFZ
    locked_until = payment_status = None
    if a.appointment_status == AppointmentStatus.TEMP_LOCK.value or a.price is not None:
        # aktywna płatność to oczekująca (PENDING) — po odmowie i ponowieniu jest obok
        # starej FAILED z tym samym created_at, więc PENDING musi mieć pierwszeństwo
        pay = db.scalar(select(Payment).where(Payment.appointment_id == a.appointment_id)
                        .order_by((Payment.payment_status == "PENDING").desc(), Payment.created_at.desc()))
        if pay is not None:
            payment_status = pay.payment_status
            if pay.payment_status == "PENDING":
                locked_until = pay.created_at + timedelta(minutes=settings.temp_lock_minutes)
    return AppointmentOut(
        appointment_id=a.appointment_id,
        appointment_datetime=a.appointment_datetime,
        appointment_status=a.appointment_status,
        appointment_type=a.appointment_type,
        allow_online=a.allow_online,
        doctor_id=a.doctor_id,
        doctor_name=doctor_user.username if doctor_user else (a.service_name or "Pracownia diagnostyczna"),
        specializations=list(doctor.specialization_names) if doctor else [],
        clinic_id=a.clinic_id,
        clinic_name=clinic.clinic_name,
        clinic_address=clinic.address,
        clinic_city=clinic.city,
        patient_id=a.patient_id,
        patient_name=f"{patient.first_name} {patient.last_name}" if patient else None,
        price=float(a.price) if a.price is not None else None,
        notes=a.appointment_notes,
        notify_earlier=a.notify_earlier,
        service_name=a.service_name,
        service_id=a.service_id,
        duration_min=a.duration_min,
        referral_required=a.referral_required,
        confirmation_requested=a.confirmation_requested,
        patient_confirmed=a.patient_confirmed,
        locked_until=locked_until,
        payment_status=payment_status,
        checked_in_at=a.checked_in_at,
        room=a.room,
    )


def get_appointment_or_404(appointment_id: UUID, db: Session) -> Appointment:
    a = db.get(Appointment, appointment_id)
    if a is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wizyta nie istnieje.")
    return a


class ArrivalIn(BaseModel):
    checked_in: bool = True
    room: str | None = Field(default=None, max_length=20)


@router.post("/appointments/{appointment_id}/arrival", response_model=AppointmentOut)
def mark_arrival(
    appointment_id: UUID,
    body: ArrivalIn,
    user: AppUser = Depends(require_roles("rejestracja", "kierownik", "administrator")),
    db: Session = Depends(get_db),
):
    """Recepcja melduje przybycie pacjenta i przydziela gabinet (albo cofa meldunek) —
    lekarz widzi „pacjent czeka" w planie dnia. Most recepcja↔gabinet."""
    a = get_appointment_or_404(appointment_id, db)
    assert_staff_in_clinic(db, user, a.clinic_id)
    if a.patient_id is None or a.appointment_status != AppointmentStatus.CONFIRMED.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Zameldować można tylko potwierdzoną wizytę z pacjentem.")
    if body.checked_in:
        a.checked_in_at = datetime.now()
        room = (body.room or "").strip() or None
        # brak gabinetu w żądaniu → bierzemy stały gabinet lekarza w tej placówce
        # (recepcja melduje jednym kliknięciem, nie wpisuje numeru)
        if room is None and a.doctor_id:
            sc = db.scalar(select(StaffClinic).where(
                StaffClinic.clinic_id == a.clinic_id, StaffClinic.user_id == a.doctor_id,
                StaffClinic.end_date.is_(None)))
            room = sc.room if sc else None
        a.room = room
    else:
        a.checked_in_at = None
        a.room = None
    db.commit()
    return appointment_out(db, a)


@router.post("/clinics/{clinic_id}/slots", status_code=status.HTTP_201_CREATED, response_model=list[AppointmentOut])
def create_slots(
    clinic_id: UUID,
    body: SlotsCreateIn,
    user: AppUser = Depends(require_roles(*SLOT_MANAGERS)),
    db: Session = Depends(get_db),
):
    """UC-PP2 / sekwencja-dodanie-terminow: nowe wolne terminy (FREE, patient_id NULL).
    Godziny muszą leżeć na siatce placówki (clinic.slot_interval_min, np. co 15 min)."""
    clinic = db.get(Clinic, clinic_id)
    if clinic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Placówka nie istnieje.")

    # usługa z katalogu (typ wizyty/przyjęcia) — z niej nazwa/cena/czas/wymóg skierowania
    service = None
    if body.service_id is not None:
        service = db.get(Service, body.service_id)
        if service is None or service.clinic_id != clinic_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usługa nie istnieje w tej placówce.")
        if not service.active:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Usługa jest nieaktywna.")

    doctor = None
    if body.doctor_id is not None:
        doctor = db.get(Doctor, body.doctor_id)
        if doctor is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lekarz nie istnieje.")
        if user.role.role_name == "lekarz" and user.user_id != body.doctor_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Lekarz może dodawać terminy tylko w swoim kalendarzu.")
        works_here = db.scalar(select(StaffClinic).where(
            StaffClinic.clinic_id == clinic_id, StaffClinic.user_id == body.doctor_id, StaffClinic.end_date.is_(None)))
        if not works_here:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Lekarz nie jest przypisany do tej placówki.")
        if service is not None and db.scalar(select(DoctorService).where(
                DoctorService.doctor_id == body.doctor_id, DoctorService.service_id == service.service_id)) is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ten lekarz nie wykonuje wybranej usługi.")

    if service is not None:
        eff_name = service.name
        eff_price = float(service.price) if service.price is not None else None
        eff_referral = service.referral_required
        eff_allow_online = service.allow_online  # slot dziedziczy „czy teleporada" z usługi
        eff_duration: int | None = service.duration_min
        # siatka (start co ile) = ATOM placówki; czas usługi to TYLKO długość (wielokrotność
        # atomu, pilnowana przy zakładaniu usługi). Usługa nie ma już własnej siatki.
        interval = clinic.slot_interval_min or 15
    else:
        # legacy: wizyta lekarska XOR badanie pracowniane
        if (body.doctor_id is None) == (body.service_name is None):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail="Podaj doctor_id (wizyta), service_name (badanie) albo service_id (usługa).")
        eff_name = body.service_name
        eff_price = body.price
        eff_referral = (body.price is None) if body.service_name else False
        eff_allow_online = body.allow_online  # wizyta lekarska: wybór z body; badanie pracowniane i tak STATIONARY
        eff_duration = None
        interval = clinic.slot_interval_min or 15

    for dt in body.datetimes:
        if dt.minute % interval != 0 or dt.second != 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Godzina {dt.strftime('%H:%M')} nie leży na siatce terminów (co {interval} min).",
            )

    created: list[Appointment] = []
    for dt in body.datetimes:
        # konflikt = ten sam dostawca + ta sama usługa/rodzaj + termin. Różne usługi
        # tego samego lekarza w nakładających się godzinach są DOZWOLONE — przy
        # rezerwacji zsynchronizuje je współrezerwacja (block_overlapping).
        q = select(Appointment).where(
            Appointment.appointment_datetime == dt,
            Appointment.appointment_status.notin_([AppointmentStatus.CANCELLED.value, AppointmentStatus.INTERRUPTED.value]),
        )
        if service is not None:
            q = q.where(Appointment.service_id == service.service_id)
            if body.doctor_id is not None:
                q = q.where(Appointment.doctor_id == body.doctor_id)
            else:
                q = q.where(Appointment.clinic_id == clinic_id, Appointment.doctor_id.is_(None))
        elif body.doctor_id is not None:
            q = q.where(Appointment.doctor_id == body.doctor_id)
        else:
            q = q.where(Appointment.clinic_id == clinic_id, Appointment.service_name == body.service_name)
        if db.scalar(q):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Termin {dt.isoformat(sep=' ', timespec='minutes')} jest już zajęty.",
            )
        a = Appointment(
            patient_id=None,
            doctor_id=body.doctor_id,
            clinic_id=clinic_id,
            appointment_datetime=dt,
            appointment_status=AppointmentStatus.FREE.value,
            appointment_type=body.appointment_type.value,
            # slot ONLINE jest z definicji online; STATIONARY dziedziczy allow_online z usługi/body
            allow_online=eff_allow_online if body.appointment_type == AppointmentType.STATIONARY else True,
            price=eff_price,
            service_name=eff_name,
            referral_required=eff_referral,
            service_id=service.service_id if service is not None else None,
            duration_min=eff_duration,
        )
        db.add(a)
        created.append(a)

    # „powiadom o wcześniejszym terminie": nowe sloty też się liczą (jedno
    # powiadomienie dla całej serii — bez spamu przy slotach cyklicznych)
    if body.doctor_id is not None:
        notify_earlier_watchers(db, doctor_id=body.doctor_id, clinic_id=clinic_id,
                                slot_dts=[a.appointment_datetime for a in created])

    # lista oczekujących (UC-P3 A1): powiadom zapisanych na tę specjalizację
    if doctor:
        notify_waitlist(db, list(doctor.specialization_names))

    db.commit()
    return [appointment_out(db, a) for a in created]


@router.delete("/slots/{appointment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_free_slot(
    appointment_id: UUID,
    _: AppUser = Depends(require_roles(*SLOT_MANAGERS)),
    db: Session = Depends(get_db),
):
    """Usunięcie błędnie dodanego WOLNEGO terminu (rejestracja/kierownik/admin).
    Zarezerwowanych nie ruszamy — od tego jest anulowanie z powiadomieniem."""
    a = get_appointment_or_404(appointment_id, db)
    if a.appointment_status != AppointmentStatus.FREE.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Można usunąć tylko wolny termin (bez rezerwacji).")
    # wolny termin może mieć osieroconą płatność (rezerwacja → płatność FAILED →
    # termin wrócił do FREE) — FK by zablokował usunięcie, więc sprzątamy ją najpierw
    for p in db.scalars(select(Payment).where(Payment.appointment_id == appointment_id)).all():
        db.delete(p)
    db.delete(a)
    db.commit()


@router.get("/slots", response_model=list[AppointmentOut])
def search_slots(
    db: Session = Depends(get_db),
    _: AppUser = Depends(get_current_user),
    specialization: str | None = None,
    doctor_id: UUID | None = Query(default=None),
    clinic_id: UUID | None = Query(default=None),
):
    """UC-P3: wyszukiwanie wolnych terminów (kalendarz pacjenta)."""
    q = (
        select(Appointment)
        # OUTER JOIN: sloty badań nie mają lekarza (doctor_id NULL) i też mają być widoczne
        .outerjoin(Doctor, Doctor.doctor_id == Appointment.doctor_id)
        .where(
            Appointment.appointment_status == AppointmentStatus.FREE.value,
            # tylko przyszłe terminy — przeszłe wolne sloty (nieodebrane) nie są
            # już dostępne do rezerwacji (spójnie z /public/slots)
            Appointment.appointment_datetime > datetime.now(),
        )
        .order_by(Appointment.appointment_datetime)
    )
    if specialization:
        q = q.where(Appointment.doctor_id.in_(
            select(DoctorSpecialization.doctor_id).where(DoctorSpecialization.name == specialization)))
    if doctor_id:
        q = q.where(Appointment.doctor_id == doctor_id)
    if clinic_id:
        q = q.where(Appointment.clinic_id == clinic_id)
    return [appointment_out(db, a) for a in db.scalars(q)]


class HoldOut(BaseModel):
    hold_token: str
    expires_at: datetime


@router.post("/appointments/{appointment_id}/hold", response_model=HoldOut)
def hold_appointment(
    appointment_id: UUID,
    _: AppUser = Depends(require_roles("pacjent", *RECEPTION_ROLES)),
    db: Session = Depends(get_db),
):
    """Miękka rezerwacja slotu na czas wypełniania formularza (panel pacjenta /
    rejestracja): FREE→TEMP_LOCK, blokada wiersza — drugi chętny dostaje 409.
    Porzucony hold zwalnia pętla tła po slot_hold_minutes."""
    a = acquire_hold(db, appointment_id)
    db.commit()
    return HoldOut(hold_token=a.confirmation_token, expires_at=a.lock_expires_at)


@router.post("/appointments/{appointment_id}/release")
def release_appointment_hold(
    appointment_id: UUID,
    hold_token: str = Query(...),
    _: AppUser = Depends(require_roles("pacjent", *RECEPTION_ROLES)),
    db: Session = Depends(get_db),
):
    """Zwolnienie miękkiej rezerwacji (np. zmiana terminu / wyjście z formularza)."""
    released = release_hold(db, appointment_id, hold_token)
    db.commit()
    return {"released": released}


def apply_p1_referral(db: Session, p1: P1Client, a: Appointment, patient_id: UUID, code: str) -> None:
    """Realizuje e-skierowanie z P1: sprawdza je względem PESEL pacjenta i
    specjalizacji wybranego lekarza (lub typu badania), zużywa (jednorazowo)
    i oznacza wizytę jako pokrytą skierowaniem zewnętrznym."""
    patient = db.get(Patient, patient_id)
    targets: list[str] = []
    if a.doctor_id is not None:
        doctor = db.get(Doctor, a.doctor_id)
        targets = list(doctor.specialization_names) if doctor else []
    if a.service_name:
        targets.append(a.service_name)
    doc_p1 = verify_p1_referral(p1, code, pesel=patient.pesel if patient else "", targets=targets)
    consume_p1_referral(p1, code)
    a.external_referral = True
    # zapis zrealizowanego e-skierowania w dokumentacji pacjenta — żeby było widoczne
    # w „Skierowaniach" jak skierowanie z NovaMed (status REALIZED = już wykorzystane)
    from app.api.documents import new_document  # import lokalny — unika cyklu
    from app.domain.documents import DocumentStatus, DocumentType
    from app.models import Referral
    spec = doc_p1.get("specialization") or a.service_name or "wizyta"
    doc = new_document(None, patient_id, a.appointment_id, DocumentType.REFERRAL, DocumentStatus.REALIZED)
    db.add(doc)
    db.flush()
    db.add(Referral(
        document_id=doc.document_id, referral_code=code,
        referral_type="SPECIALIST" if a.doctor_id is not None else "LAB",
        notes=f"{spec} — e-skierowanie zewnętrzne z P1 (zrealizowane przy rezerwacji)",
    ))
    a.referral_document_id = doc.document_id


@router.post("/appointments/{appointment_id}/book", response_model=BookOut)
def book_appointment(
    appointment_id: UUID,
    body: BookIn | None = None,
    as_patient: UUID | None = Query(default=None, description="Konta rodzinne: rezerwacja w imieniu podopiecznego"),
    user: AppUser = Depends(require_roles("pacjent")),
    db: Session = Depends(get_db),
    ewus: EwusClient = Depends(get_ewus_client),
    payments: PaymentsClient = Depends(get_payments_client),
    p1: P1Client = Depends(get_p1_client),
):
    """UC-P3 + UC-O1 + UC-I4. Wizyta bezpłatna: FREE→CONFIRMED.
    Wizyta płatna: FREE→TEMP_LOCK + płatność PENDING u operatora —
    finalizacja przez /appointments/{id}/pay (diagramie stanów wizyty).
    Przy rezerwacji system weryfikuje ubezpieczenie w eWUŚ (best-effort)."""
    patient_id = resolve_patient_id(db, user, as_patient)
    # blokada wiersza + akceptacja slotu wolnego ALBO trzymanego MOIM holdem
    a = db.get(Appointment, appointment_id, with_for_update=True)
    if a is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Termin nie istnieje.")
    if a.appointment_status != AppointmentStatus.FREE.value and not held_by(a, body.hold_token if body else None):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ten termin nie jest już dostępny.")
    if a.appointment_datetime < datetime.now():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ten termin już minął — wybierz inny.")

    # badanie ze skierowaniem: wymagane nasze skierowanie ALBO oświadczenie o zewnętrznym
    if a.referral_required:
        ref_id = body.referral_document_id if body else None
        p1_code = (body.p1_referral_code.strip() if body and body.p1_referral_code else None)
        external = bool(body and body.external_referral)
        if not ref_id and not p1_code and not external:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"„{a.service_name}” na NFZ wymaga skierowania — wskaż e-skierowanie z NovaMed, "
                       "podaj kod e-skierowania z P1 albo oświadcz, że masz zewnętrzne.",
            )
        if ref_id:
            from app.models import MedicalDocument  # import lokalny — unika cyklu
            ref = db.get(MedicalDocument, ref_id)
            if ref is None or ref.patient_id != patient_id or ref.document_type != "REFERRAL":
                raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                    detail="Wskazane skierowanie nie istnieje lub nie należy do pacjenta.")
            a.referral_document_id = ref_id
        elif p1_code:
            apply_p1_referral(db, p1, a, patient_id, p1_code)
        else:
            # NFZ (termin bez ceny): refundacja przysługuje tylko z realnym e-skierowaniem
            # w P1 — papierowe oświadczenie honorowe nie wystarcza.
            if a.price is None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Na NFZ wymagane jest e-skierowanie (podaj kod z P1) — "
                           "papierowe oświadczenie nie daje refundacji.",
                )
            a.external_referral = True

    # skierowanie do specjalisty (SPECIALIST): rezerwacja WIZYTY (nie badania) realizuje
    # skierowanie — inaczej zostaje „do umówienia" na zawsze (LAB realizuje wynik, NURSING zabieg)
    elif body and body.referral_document_id is not None and a.service_name is None:
        from app.models import MedicalDocument, Referral  # import lokalny — unika cyklu
        from app.domain.documents import DocumentStatus
        ref = db.get(MedicalDocument, body.referral_document_id)
        sref = db.scalar(select(Referral).where(Referral.document_id == body.referral_document_id)) if ref else None
        if (ref is not None and ref.patient_id == patient_id and ref.document_type == "REFERRAL"
                and sref is not None and sref.referral_type == "SPECIALIST"
                and ref.document_status not in (DocumentStatus.REALIZED.value, DocumentStatus.REVOKED.value)):
            a.referral_document_id = ref.document_id
            ref.document_status = DocumentStatus.REALIZED.value

    # powód wizyty i opcje rezerwacji (opcjonalne body)
    if body:
        if body.reason:
            a.appointment_notes = body.reason.strip()[:500]
        a.notify_earlier = body.notify_earlier
        # teleporada to wybór pacjenta — dozwolony, gdy slot na nią zezwala (allow_online;
        # konsultacja-usługa też, badanie/USG nie). Gdy nie zezwala, prośbę ignorujemy.
        if body.online and a.allow_online:
            a.appointment_type = AppointmentType.ONLINE.value

    # eWUŚ — automatyczna weryfikacja przy rejestracji wizyty; awaria nie blokuje rezerwacji
    patient = db.get(Patient, patient_id)
    try:
        patient.insurance_status = ewus.verify(pesel=patient.pesel)
    except IntegrationError:
        pass

    if a.price is None:
        assert_transition(a.appointment_status, AppointmentStatus.CONFIRMED)  # TEMP_LOCK(hold)→CONFIRMED też dozwolone
        a.patient_id = patient_id
        a.appointment_status = AppointmentStatus.CONFIRMED.value
        a.lock_expires_at = None
        block_overlapping(db, a)  # lekarz zajęty → nakładające się usługi znikają z puli
        join, manage = audience_links(db, a, online=a.appointment_type == AppointmentType.ONLINE.value)
        notify(db, patient_id, *messages.visit_confirmed(
            visit_label(db, a), join_link=join, manage_link=manage), email=True)
        db.commit()
        return BookOut(appointment=appointment_out(db, a))

    # płatność na miejscu — potwierdzamy od razu (jak NFZ/recepcja), rozliczenie w okienku.
    # Teleporada (online) NIE może być „na miejscu" — pacjenta nie ma w placówce, więc zawsze
    # płaci z góry online → taki termin pomija tę gałąź i idzie do bramki niżej.
    if body and body.pay_on_site and a.appointment_type != AppointmentType.ONLINE.value:
        assert_transition(a.appointment_status, AppointmentStatus.CONFIRMED)
        a.patient_id = patient_id
        a.appointment_status = AppointmentStatus.CONFIRMED.value
        a.lock_expires_at = None
        onsite = Payment(appointment_id=a.appointment_id, amount=a.price, payment_status="PAID",
                         provider_ref="NA_MIEJSCU", created_at=datetime.now(), paid_at=datetime.now())
        db.add(onsite)
        db.flush()
        block_overlapping(db, a)
        join, manage = audience_links(db, a, online=False)  # płatność na miejscu → nigdy online
        notify(db, patient_id, *messages.visit_confirmed(
            visit_label(db, a), join_link=join, manage_link=manage, on_site_amount=float(a.price)), email=True)
        db.commit()
        return BookOut(appointment=appointment_out(db, a), payment=PaymentInfoOut(
            payment_id=onsite.payment_id, provider_ref="NA_MIEJSCU", amount=float(a.price), payment_status="PAID"))

    # slot trzymany holdem jest już TEMP_LOCK — przejście TEMP_LOCK→TEMP_LOCK pomijamy
    if a.appointment_status != AppointmentStatus.TEMP_LOCK.value:
        assert_transition(a.appointment_status, AppointmentStatus.TEMP_LOCK)
    a.patient_id = patient_id
    a.appointment_status = AppointmentStatus.TEMP_LOCK.value
    a.lock_expires_at = None  # hold zamienia się w blokadę płatności (steruje nią Payment.created_at)
    try:
        provider_ref = payments.create_payment(
            amount=float(a.price), reference=f"appointment-{a.appointment_id}",
        )
    except IntegrationError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=exc.message) from exc
    payment = Payment(
        appointment_id=a.appointment_id,
        amount=a.price,
        payment_status="PENDING",
        provider_ref=provider_ref,
        # jawnie czas lokalny — server_default w sqlite dawałby UTC i psuł
        # liczenie timeoutu TEMP_LOCK (release_expired_temp_locks)
        created_at=datetime.now(),
    )
    db.add(payment)
    block_overlapping(db, a)  # blokada płatności zajmuje czas lekarza → nakładające się usługi znikają
    db.commit()
    return BookOut(
        appointment=appointment_out(db, a),
        payment=PaymentInfoOut(
            payment_id=payment.payment_id, provider_ref=provider_ref,
            amount=float(a.price), payment_status="PENDING",
        ),
    )


class RegisterPatientIn(BaseModel):
    first_name: str = Field(min_length=1, max_length=50)
    last_name: str = Field(min_length=1, max_length=50)
    pesel: str = Field(min_length=11, max_length=11, pattern=r"^\d{11}$")
    birth_date: date
    phone_number: str = Field(min_length=7, max_length=20)
    email: EmailStr | None = None

    @field_validator("pesel")
    @classmethod
    def check_pesel(cls, v: str) -> str:
        if not pesel_valid(v):
            raise ValueError("Nieprawidłowy numer PESEL (błędna suma kontrolna).")
        return v


class ReceptionPatientOut(BaseModel):
    patient_id: UUID
    first_name: str
    last_name: str
    pesel: str
    phone_number: str | None
    existing: bool  # pacjent już był w systemie (znaleziony po PESEL)


@router.post("/patients/register", status_code=status.HTTP_201_CREATED, response_model=ReceptionPatientOut)
def reception_register_patient(
    body: RegisterPatientIn,
    _: AppUser = Depends(require_roles(*RECEPTION_ROLES)),
    db: Session = Depends(get_db),
):
    """Rejestracja zakłada konto pacjenta przy zgłoszeniu telefonicznym/osobistym
    (gdy dzwoniący nie ma jeszcze konta). Konto nieaktywne (jak gość z M8.6) —
    pacjent przejmuje je przy samodzielnej rejestracji tym samym e-mailem.
    Dedup po PESEL: istniejący pacjent jest zwracany (existing=True), bez dubla."""
    existing = db.scalar(select(Patient).where(Patient.pesel == body.pesel))
    if existing:
        owner = db.get(AppUser, existing.patient_id)
        if not owner.active_account and body.phone_number:
            owner.phone_number = body.phone_number  # uzupełnij kontakt na koncie-gościu
            db.commit()
        return ReceptionPatientOut(
            patient_id=existing.patient_id, first_name=existing.first_name,
            last_name=existing.last_name, pesel=existing.pesel,
            phone_number=owner.phone_number, existing=True,
        )

    role = db.scalar(select(Role).where(Role.role_name == "pacjent"))
    guest = AppUser(
        role_id=role.role_id, supabase_uid=uuid.uuid4(),
        username=f"{body.first_name} {body.last_name}",
        email=str(body.email).lower() if body.email else f"guest-{uuid.uuid4().hex[:12]}@novamed.local",
        phone_number=body.phone_number, active_account=False,
    )
    db.add(guest)
    db.flush()
    db.add(Patient(
        patient_id=guest.user_id, first_name=body.first_name, last_name=body.last_name,
        pesel=body.pesel, birth_date=body.birth_date,
    ))
    db.commit()
    return ReceptionPatientOut(
        patient_id=guest.user_id, first_name=body.first_name, last_name=body.last_name,
        pesel=body.pesel, phone_number=body.phone_number, existing=False,
    )


class BookForIn(BaseModel):
    patient_id: UUID
    reason: str | None = Field(default=None, max_length=500)
    external_referral: bool = False
    referral_document_id: UUID | None = None  # e-skierowanie z NovaMed (badanie NFZ)
    p1_referral_code: str | None = Field(default=None, max_length=20)  # kod e-skierowania z P1
    online: bool = False  # recepcja umawia teleporadę (slot stacjonarny z allow_online)
    hold_token: str | None = None  # token miękkiej rezerwacji slotu


@router.post("/appointments/{appointment_id}/book-for", response_model=AppointmentOut)
def book_for_patient(
    appointment_id: UUID,
    body: BookForIn,
    _: AppUser = Depends(require_roles(*RECEPTION_ROLES)),
    db: Session = Depends(get_db),
    ewus: EwusClient = Depends(get_ewus_client),
    p1: P1Client = Depends(get_p1_client),
):
    """Rezerwacja przez rejestrację w imieniu pacjenta (telefon/okienko) — UC-PP1.
    Termin FREE→CONFIRMED od razu (bez TEMP_LOCK): płatność za wizytę płatną
    rozlicza recepcja na miejscu, więc zapisujemy ją jako opłaconą."""
    a = db.get(Appointment, appointment_id, with_for_update=True)
    if a is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Termin nie istnieje.")
    if a.appointment_status != AppointmentStatus.FREE.value and not held_by(a, body.hold_token):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ten termin nie jest już dostępny.")
    if a.appointment_datetime < datetime.now():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ten termin już minął — wybierz inny.")
    patient = db.get(Patient, body.patient_id)
    if patient is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pacjent nie istnieje.")
    p1_code = body.p1_referral_code.strip() if body.p1_referral_code else None
    if a.referral_required and not body.external_referral and body.referral_document_id is None and not p1_code:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"„{a.service_name}” na NFZ wymaga skierowania — wskaż e-skierowanie z NovaMed, "
                   "podaj kod e-skierowania z P1 albo potwierdź skierowanie zewnętrzne.",
        )

    if a.referral_required:
        if body.referral_document_id is not None:
            from app.models import MedicalDocument  # import lokalny — unika cyklu
            ref = db.get(MedicalDocument, body.referral_document_id)
            if ref is None or ref.patient_id != body.patient_id or ref.document_type != "REFERRAL":
                raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                    detail="Wskazane skierowanie nie istnieje lub nie należy do pacjenta.")
            a.referral_document_id = body.referral_document_id
        elif p1_code:
            apply_p1_referral(db, p1, a, body.patient_id, p1_code)
        else:
            # NFZ — papierowe oświadczenie nie daje refundacji; tylko e-skierowanie z P1.
            if a.price is None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Na NFZ wymagane jest e-skierowanie (podaj kod z P1) — "
                           "papierowe oświadczenie nie daje refundacji.",
                )
            a.external_referral = True
    if body.reason:
        a.appointment_notes = body.reason.strip()[:500]
    # teleporada to wybór przy umawianiu — dozwolony, gdy slot na nią zezwala (allow_online),
    # spójnie z pacjenckim /book (body.online). Pracownia/badanie i tak zostaje stacjonarne.
    if body.online and a.allow_online:
        a.appointment_type = AppointmentType.ONLINE.value
    try:
        patient.insurance_status = ewus.verify(pesel=patient.pesel)
    except IntegrationError:
        pass

    assert_transition(a.appointment_status, AppointmentStatus.CONFIRMED)  # FREE/TEMP_LOCK(hold)→CONFIRMED
    a.patient_id = body.patient_id
    a.appointment_status = AppointmentStatus.CONFIRMED.value
    a.lock_expires_at = None
    block_overlapping(db, a)
    if a.price is not None:
        db.add(Payment(
            appointment_id=a.appointment_id, amount=a.price, payment_status="PAID",
            provider_ref="RECEPCJA", created_at=datetime.now(), paid_at=datetime.now(),
        ))
    join, manage = audience_links(db, a, online=a.appointment_type == AppointmentType.ONLINE.value)
    notify(db, body.patient_id, *messages.visit_confirmed(
        visit_label(db, a), join_link=join, manage_link=manage), email=True)
    db.commit()
    return appointment_out(db, a)


class WalkInIn(BaseModel):
    patient_id: UUID


@router.post("/appointments/walk-in", response_model=AppointmentOut)
def walk_in(
    body: WalkInIn,
    user: AppUser = Depends(require_roles("lekarz")),
    db: Session = Depends(get_db),
):
    """Dostawka: lekarz przyjmuje pacjenta bez wcześniejszej rezerwacji — tworzy
    wizytę „teraz" w swojej placówce. Pozwala też wystawić dokumenty poza
    zaplanowaną wizytą (kontekstem jest ta wizyta)."""
    if db.get(Patient, body.patient_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pacjent nie istnieje.")
    sc = db.scalar(select(StaffClinic).where(StaffClinic.user_id == user.user_id))
    if sc is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Nie jesteś przypisany do żadnej placówki.")
    a = Appointment(
        patient_id=body.patient_id, doctor_id=user.user_id, clinic_id=sc.clinic_id,
        appointment_datetime=datetime.now(), appointment_status=AppointmentStatus.CONFIRMED.value,
        appointment_type=AppointmentType.STATIONARY.value,
    )
    db.add(a)
    db.commit()
    return appointment_out(db, a)


@router.post("/appointments/{appointment_id}/pay", response_model=BookOut)
def pay_appointment(
    appointment_id: UUID,
    body: PayIn,
    user: AppUser = Depends(require_roles("pacjent")),
    db: Session = Depends(get_db),
    payments: PaymentsClient = Depends(get_payments_client),
):
    """Finalizacja płatności (mock symuluje autoryzację klienta u operatora).
    Sukces: TEMP_LOCK→CONFIRMED. Odmowa: termin zostaje TEMP_LOCK (trzymany dla
    pacjenta) i otwierana jest nowa próba płatności — pacjent może spróbować ponownie
    do końca okna blokady; po jego upływie sweep zwalnia termin do puli."""
    a = get_appointment_or_404(appointment_id, db)
    if a.patient_id not in allowed_patient_ids(db, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="To nie jest Twoja rezerwacja.")
    if a.appointment_status != AppointmentStatus.TEMP_LOCK.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ta wizyta nie oczekuje na płatność.")
    payment = db.scalar(select(Payment).where(
        Payment.appointment_id == a.appointment_id,
        Payment.payment_status == "PENDING",
    ))
    if payment is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Brak oczekującej płatności dla tej wizyty.")

    try:
        payments.confirm(provider_ref=payment.provider_ref, outcome=body.outcome)
        final_status = payments.get_status(provider_ref=payment.provider_ref)
    except IntegrationError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=exc.message) from exc

    if final_status == "PAID":
        payment.payment_status = "PAID"
        payment.paid_at = datetime.now()
        assert_transition(a.appointment_status, AppointmentStatus.CONFIRMED)
        a.appointment_status = AppointmentStatus.CONFIRMED.value
        join, manage = audience_links(db, a, online=a.appointment_type == AppointmentType.ONLINE.value)
        notify(db, user.user_id, *messages.visit_paid_confirmed(
            visit_label(db, a), float(payment.amount), join_link=join, manage_link=manage), email=True)
    else:
        # Odmowa NIE kasuje rezerwacji: termin zostaje TEMP_LOCK (trzymany dla pacjenta),
        # nakładające się sloty pozostają zablokowane, listy oczekujących nie ruszamy.
        # Bramka nie pozwala potwierdzić tej samej płatności dwa razy (odmowa jest
        # terminalna), więc otwieramy NOWĄ próbę — z zachowanym created_at, żeby okno
        # blokady TEMP_LOCK nie wydłużało się przez kolejne odmowy.
        payment.payment_status = "FAILED"
        try:
            retry_ref = payments.create_payment(
                amount=float(payment.amount), reference=f"appointment-{a.appointment_id}")
        except IntegrationError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=exc.message) from exc
        payment = Payment(
            appointment_id=a.appointment_id, amount=payment.amount,
            payment_status="PENDING", provider_ref=retry_ref,
            created_at=payment.created_at,  # zachowane pierwotne okno blokady
        )
        db.add(payment)
        db.flush()
        notify(db, user.user_id, *messages.payment_declined(), sms=False)
    db.commit()
    return BookOut(
        appointment=appointment_out(db, a),
        payment=PaymentInfoOut(
            payment_id=payment.payment_id, provider_ref=payment.provider_ref,
            amount=float(payment.amount), payment_status=payment.payment_status,
        ),
    )


@router.post("/appointments/{appointment_id}/cancel-payment", response_model=AppointmentOut)
def cancel_payment(
    appointment_id: UUID,
    user: AppUser = Depends(require_roles("pacjent")),
    db: Session = Depends(get_db),
):
    """Rezygnacja z płatności na żądanie pacjenta — zwalnia termin OD RAZU, bez czekania
    na upływ okna blokady. TEMP_LOCK→FREE, oczekująca płatność oznaczana FAILED, czas
    lekarza wraca do puli, a listy oczekujących dostają sygnał o wolnym terminie."""
    a = get_appointment_or_404(appointment_id, db)
    # status przed właścicielem: wolny termin (już zwolniony) → 409, cudzy TEMP_LOCK → 403
    if a.appointment_status != AppointmentStatus.TEMP_LOCK.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ta wizyta nie oczekuje na płatność.")
    if a.patient_id not in allowed_patient_ids(db, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="To nie jest Twoja rezerwacja.")
    for p in db.scalars(select(Payment).where(
            Payment.appointment_id == a.appointment_id, Payment.payment_status == "PENDING")):
        p.payment_status = "FAILED"
    assert_transition(a.appointment_status, AppointmentStatus.FREE)
    a.appointment_status = AppointmentStatus.FREE.value
    a.patient_id = None
    a.notify_earlier = False
    a.confirmation_token = None
    a.lock_expires_at = None
    restore_blocked(db, a)
    notify_earlier_watchers(db, doctor_id=a.doctor_id, clinic_id=a.clinic_id, slot_dts=[a.appointment_datetime])
    db.commit()
    return appointment_out(db, a)


@router.post("/appointments/{appointment_id}/confirm-attendance", response_model=AppointmentOut)
def confirm_attendance(
    appointment_id: UUID,
    user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Potwierdzenie obecności przez pacjenta (lub opiekuna) — gdy placówka
    wymaga potwierdzania wizyt. Personel też może odhaczyć (np. po telefonie)."""
    a = get_appointment_or_404(appointment_id, db)
    if user.role.role_name == "pacjent" and a.patient_id not in allowed_patient_ids(db, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="To nie jest Twoja wizyta.")
    if a.appointment_status != AppointmentStatus.CONFIRMED.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tę wizytę można potwierdzić tylko, gdy jest zarezerwowana.")
    a.patient_confirmed = True
    db.commit()
    return appointment_out(db, a)


@router.post("/appointments/{appointment_id}/cancel", response_model=AppointmentOut)
def cancel_appointment(
    appointment_id: UUID,
    user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """UC-P10: anulowanie. Polityka 24 h dla pacjenta; personel może zawsze.
    Jeśli jest jeszcze czas, termin wraca do puli jako NOWY wolny slot
    (historia odwołanej wizyty zostaje) — zgodnie z diagramem stanów wizyty."""
    a = get_appointment_or_404(appointment_id, db)
    is_patient = user.role.role_name == "pacjent"
    if is_patient and a.patient_id not in allowed_patient_ids(db, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="To nie jest Twoja wizyta.")

    # porzucenie rezerwacji w trakcie płatności: TEMP_LOCK→FREE (ten sam slot wraca do puli)
    if a.appointment_status == AppointmentStatus.TEMP_LOCK.value:
        pending = db.scalar(select(Payment).where(
            Payment.appointment_id == a.appointment_id, Payment.payment_status == "PENDING",
        ))
        if pending:
            pending.payment_status = "FAILED"
        a.appointment_status = AppointmentStatus.FREE.value
        a.patient_id = None
        a.notify_earlier = False
        notify_earlier_watchers(db, doctor_id=a.doctor_id, clinic_id=a.clinic_id, slot_dts=[a.appointment_datetime])
        db.commit()
        return appointment_out(db, a)

    hours_left = (a.appointment_datetime - datetime.now()).total_seconds() / 3600
    if is_patient and hours_left < CANCEL_MIN_HOURS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Wizyty nie można anulować na mniej niż {CANCEL_MIN_HOURS} h przed terminem. Skontaktuj się z rejestracją.",
        )

    assert_transition(a.appointment_status, AppointmentStatus.CANCELLED)
    a.appointment_status = AppointmentStatus.CANCELLED.value
    restore_blocked(db, a)  # czas lekarza wolny → nakładające się usługi wracają do puli
    # zwrot opłaty za odwołaną wizytę płatną — oznaczamy płatność jako zwróconą
    refunded = False
    if a.price is not None:
        paid = db.scalar(select(Payment).where(
            Payment.appointment_id == a.appointment_id, Payment.payment_status == "PAID"))
        if paid is not None:
            paid.payment_status = "REFUNDED"
            refunded = True
    if a.patient_id:
        notify(db, a.patient_id, *messages.visit_cancelled(visit_label(db, a), refunded=refunded), email=True)

    # zwrot terminu do puli, jeśli wizyta jeszcze przed czasem
    if hours_left > 0:
        db.add(Appointment(
            patient_id=None,
            doctor_id=a.doctor_id,
            clinic_id=a.clinic_id,
            appointment_datetime=a.appointment_datetime,
            appointment_status=AppointmentStatus.FREE.value,
            appointment_type=a.appointment_type,
            allow_online=a.allow_online,
            price=a.price,
            service_name=a.service_name,            # badanie/usługa: zachowaj rodzaj…
            referral_required=a.referral_required,  # …i wymóg skierowania
            service_id=a.service_id, duration_min=a.duration_min,  # …i kontekst współrezerwacji
        ))
        notified = notify_earlier_watchers(db, doctor_id=a.doctor_id, clinic_id=a.clinic_id, slot_dts=[a.appointment_datetime])
        # zwolniony termin u lekarza → powiadom listę oczekujących tej specjalizacji
        # (z pominięciem tych, którzy już dostali alert „wcześniejszy termin")
        if a.doctor_id is not None:
            doc = db.get(Doctor, a.doctor_id)
            notify_waitlist(db, list(doc.specialization_names) if doc else None, freed=True, exclude=notified)
    db.commit()
    return appointment_out(db, a)


def perform_reschedule(db: Session, old: Appointment, new: Appointment) -> Appointment:
    """Rdzeń przełożenia: walidacja nowego terminu + przeniesienie rezerwacji
    (zwrot starego do puli, transfer płatności, współrezerwacja, powiadomienie).
    Zakłada, że `old` jest CONFIRMED (sprawdza wywołujący). Bez commita — woła go
    wywołujący. Używany przez pacjenta/recepcję (authed) i gościa (link z SMS)."""
    if new.appointment_status != AppointmentStatus.FREE.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Wybrany nowy termin nie jest już dostępny.")
    if new.appointment_datetime < datetime.now():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Nowy termin już minął — wybierz inny.")
    # przełożenie tylko na ten sam rodzaj (ten sam lekarz / to samo badanie)
    if new.doctor_id != old.doctor_id or new.service_name != old.service_name:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Nowy termin musi dotyczyć tego samego lekarza/badania co obecna wizyta.")
    # ta sama cena = przeniesienie bez dopłaty/zwrotu
    if (new.price or 0) != (old.price or 0):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Nowy termin ma inną cenę niż obecna wizyta — anuluj i zarezerwuj osobno.")

    assert_transition(old.appointment_status, AppointmentStatus.CANCELLED)
    old.appointment_status = AppointmentStatus.CANCELLED.value
    restore_blocked(db, old)
    # zwrot starego terminu do puli tylko, jeśli jeszcze przed czasem
    if old.appointment_datetime > datetime.now():
        db.add(Appointment(
            patient_id=None,
            doctor_id=old.doctor_id,
            clinic_id=old.clinic_id,
            appointment_datetime=old.appointment_datetime,
            appointment_status=AppointmentStatus.FREE.value,
            appointment_type=old.appointment_type,
            allow_online=old.allow_online,
            price=old.price,
            service_name=old.service_name,
            referral_required=old.referral_required,
            service_id=old.service_id, duration_min=old.duration_min,
        ))
        notified = notify_earlier_watchers(db, doctor_id=old.doctor_id, clinic_id=old.clinic_id, slot_dts=[old.appointment_datetime])
        if old.doctor_id is not None:
            od = db.get(Doctor, old.doctor_id)
            notify_waitlist(db, list(od.specialization_names) if od else None, freed=True, exclude=notified)
    # płatność (jeśli była) wędruje na nowy termin — pacjent nie płaci drugi raz
    if old.price is not None:
        paid = db.scalar(select(Payment).where(
            Payment.appointment_id == old.appointment_id, Payment.payment_status == "PAID",
        ))
        if paid:
            paid.appointment_id = new.appointment_id

    new.patient_id = old.patient_id  # przełożenie zachowuje pacjenta (także podopiecznego)
    new.appointment_status = AppointmentStatus.CONFIRMED.value
    block_overlapping(db, new)
    new.notify_earlier = old.notify_earlier      # preferencja wędruje z wizytą
    new.appointment_notes = old.appointment_notes  # powód wizyty też (lekarz nie traci wywiadu)
    # każde przełożenie → informacyjny SMS o nowym terminie, BEZ confirm-linku
    if old.patient_id:
        join, manage = audience_links(db, new, online=new.appointment_type == AppointmentType.ONLINE.value)
        notify(db, old.patient_id, *messages.visit_rescheduled(
            visit_label(db, new), join_link=join, manage_link=manage), email=True)
    return new


@router.post("/appointments/{appointment_id}/reschedule", response_model=AppointmentOut)
def reschedule_appointment(
    appointment_id: UUID,
    body: RescheduleIn,
    user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """UC-P9: przełożenie = nowy slot + zwolnienie starego. Pacjent: tylko swoje
    wizyty i polityka 24 h. Rejestracja/kierownik/administrator: dowolna wizyta,
    bez limitu 24 h (obsługa telefoniczna). Opłacona wizyta przenosi się WRAZ
    z płatnością na nowy termin tej samej ceny — bez ponownej zapłaty."""
    role = user.role.role_name
    is_patient = role == "pacjent"
    if not is_patient and role not in RECEPTION_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Brak uprawnień do przełożenia wizyty.")

    old = get_appointment_or_404(appointment_id, db)
    if is_patient and old.patient_id not in allowed_patient_ids(db, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="To nie jest Twoja wizyta.")
    if old.appointment_status != AppointmentStatus.CONFIRMED.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Przełożyć można tylko zarezerwowaną wizytę.")

    hours_left = (old.appointment_datetime - datetime.now()).total_seconds() / 3600
    if is_patient and hours_left < CANCEL_MIN_HOURS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Wizyty nie można przełożyć na mniej niż {CANCEL_MIN_HOURS} h przed terminem. Skontaktuj się z rejestracją.",
        )

    new = get_appointment_or_404(body.new_appointment_id, db)
    perform_reschedule(db, old, new)
    db.commit()
    return appointment_out(db, new)


@router.get("/appointments/my", response_model=list[AppointmentOut])
def my_appointments(
    as_patient: UUID | None = Query(default=None),
    user: AppUser = Depends(require_roles("pacjent")),
    db: Session = Depends(get_db),
):
    """UC-P3/P4: lista wizyt pacjenta (bez wolnych slotów); konta rodzinne: ?as_patient=."""
    from app.models import Review  # import lokalny — unika cyklu

    patient_id = resolve_patient_id(db, user, as_patient)
    rows = db.scalars(
        select(Appointment)
        .where(Appointment.patient_id == patient_id)
        .order_by(Appointment.appointment_datetime.desc())
    ).all()
    reviewed_ids = set(db.scalars(select(Review.appointment_id).where(
        Review.appointment_id.in_([a.appointment_id for a in rows] or [0]),
    )))
    out = []
    for a in rows:
        item = appointment_out(db, a)
        item.reviewed = a.appointment_id in reviewed_ids
        out.append(item)
    return out


@router.get("/appointments/day", response_model=list[AppointmentOut])
def doctor_day(
    day: str = Query(description="Data w formacie YYYY-MM-DD"),
    user: AppUser = Depends(require_roles("lekarz")),
    db: Session = Depends(get_db),
):
    """UC-L1: grafik dnia lekarza (wszystkie statusy, łącznie z wolnymi slotami)."""
    try:
        start = datetime.fromisoformat(day)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Nieprawidłowa data.") from exc
    rows = db.scalars(
        select(Appointment)
        .where(
            Appointment.doctor_id == user.user_id,
            Appointment.appointment_datetime >= start,
            Appointment.appointment_datetime < start + timedelta(days=1),
        )
        .order_by(Appointment.appointment_datetime)
    )
    return [appointment_out(db, a) for a in rows]


@router.get("/appointments/active", response_model=list[AppointmentOut])
def doctor_active_visits(
    user: AppUser = Depends(require_roles("lekarz")),
    db: Session = Depends(get_db),
):
    """Otwarte wizyty lekarza (w toku / wstrzymane) niezależnie od daty — zasila
    pasek „wizyta w toku". Dzięki temu pasek działa też po północy albo gdy
    wizyta jest z innego dnia (przy maks. jednej IN_PROGRESS na lekarza)."""
    rows = db.scalars(
        select(Appointment)
        .where(
            Appointment.doctor_id == user.user_id,
            Appointment.appointment_status.in_([
                AppointmentStatus.IN_PROGRESS.value, AppointmentStatus.PAUSED.value,
            ]),
        )
        .order_by(Appointment.appointment_datetime)
    )
    return [appointment_out(db, a) for a in rows]


@router.get("/clinics/{clinic_id}/day", response_model=list[AppointmentOut])
def clinic_day(
    clinic_id: UUID,
    day: str = Query(description="Data w formacie YYYY-MM-DD"),
    user: AppUser = Depends(require_roles("rejestracja", "kierownik", "administrator")),
    db: Session = Depends(get_db),
):
    """Grafik dnia placówki dla rejestracji (UC-PP2): WSZYSTKIE terminy danego
    dnia — wolne i zajęte, wszyscy lekarze + badania — żeby ocenić obłożenie
    i znaleźć lukę, a nie tylko płaską listę wolnych slotów."""
    assert_staff_in_clinic(db, user, clinic_id)
    try:
        start = datetime.fromisoformat(day)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Nieprawidłowa data.") from exc
    rows = db.scalars(
        select(Appointment)
        .where(
            Appointment.clinic_id == clinic_id,
            Appointment.appointment_status != AppointmentStatus.CANCELLED.value,
            Appointment.appointment_datetime >= start,
            Appointment.appointment_datetime < start + timedelta(days=1),
        )
        .order_by(Appointment.appointment_datetime)
    )
    return [appointment_out(db, a) for a in rows]


class RemindOut(BaseModel):
    sent: int


@router.post("/clinics/{clinic_id}/remind-unconfirmed", response_model=RemindOut)
def remind_unconfirmed(
    clinic_id: UUID,
    day: str = Query(description="Data w formacie YYYY-MM-DD"),
    user: AppUser = Depends(require_roles(*RECEPTION_ROLES)),
    db: Session = Depends(get_db),
):
    """Zbiorcze przypomnienie SMS/in-app o potwierdzenie obecności dla wszystkich
    niepotwierdzonych wizyt danego dnia (Pulpit rejestracji)."""
    assert_staff_in_clinic(db, user, clinic_id)
    try:
        start = datetime.fromisoformat(day)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Nieprawidłowa data.") from exc
    rows = db.scalars(
        select(Appointment).where(
            Appointment.clinic_id == clinic_id,
            Appointment.appointment_status == AppointmentStatus.CONFIRMED.value,
            Appointment.patient_id.is_not(None),
            Appointment.patient_confirmed.is_(False),
            Appointment.appointment_datetime >= start,
            Appointment.appointment_datetime < start + timedelta(days=1),
        )
    ).all()
    sent = 0
    for a in rows:
        who = db.get(AppUser, a.doctor_id).username if a.doctor_id else a.service_name
        link = confirm_link(ensure_confirm_token(a))
        notify(db, a.patient_id, *messages.confirm_request(who, a.appointment_datetime, link=link))
        a.confirmation_requested = True
        sent += 1
    db.commit()
    return RemindOut(sent=sent)


@router.get("/patients/{patient_id}/appointments", response_model=list[AppointmentOut])
def patient_appointments(
    patient_id: UUID,
    user: AppUser = Depends(require_roles("lekarz", "pielegniarka", "rejestracja", "kierownik", "administrator")),
    db: Session = Depends(get_db),
):
    """UC-L1/UC-N1: historia wizyt pacjenta (kartoteka dla personelu)."""
    if db.get(Patient, patient_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pacjent nie istnieje.")
    assert_staff_can_access_patient(db, user, patient_id)
    rows = db.scalars(
        select(Appointment)
        .where(Appointment.patient_id == patient_id)
        .order_by(Appointment.appointment_datetime.desc())
    )
    return [appointment_out(db, a) for a in rows]


@router.get("/appointments/{appointment_id}/ics")
def appointment_ics(
    appointment_id: UUID,
    user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Eksport wizyty do kalendarza (plik .ics) — uczestnicy wizyty."""
    from fastapi.responses import Response

    a = get_appointment_or_404(appointment_id, db)
    if user.user_id != a.doctor_id and a.patient_id not in allowed_patient_ids(db, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Brak dostępu do tej wizyty.")

    doctor_user = db.get(AppUser, a.doctor_id) if a.doctor_id else None
    doctor = db.get(Doctor, a.doctor_id) if a.doctor_id else None
    clinic = db.get(Clinic, a.clinic_id)
    start = a.appointment_datetime
    end = start + timedelta(minutes=30)
    fmt = "%Y%m%dT%H%M%S"
    location = "Teleporada online (NovaMed)" if a.appointment_type == "ONLINE" else f"{clinic.clinic_name}, {clinic.address}"
    spec = ", ".join(doctor.specialization_names) if doctor else ""
    summary = (f"Badanie: {a.service_name}" if a.doctor_id is None
               else f"Wizyta: {doctor_user.username}" + (f" ({spec})" if spec else ""))

    # TZID + VTIMEZONE: bez strefy import w innej strefie przesuwałby godzinę.
    # Alarm -PT24H spójny z przypomnieniem SMS (24 h przed wizytą).
    ics = "\r\n".join([
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//NovaMed//Portal Medyczny//PL",
        "BEGIN:VTIMEZONE",
        "TZID:Europe/Warsaw",
        "BEGIN:STANDARD",
        "DTSTART:19701025T030000",
        "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
        "TZOFFSETFROM:+0200",
        "TZOFFSETTO:+0100",
        "END:STANDARD",
        "BEGIN:DAYLIGHT",
        "DTSTART:19700329T020000",
        "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
        "TZOFFSETFROM:+0100",
        "TZOFFSETTO:+0200",
        "END:DAYLIGHT",
        "END:VTIMEZONE",
        "BEGIN:VEVENT",
        f"UID:novamed-appointment-{a.appointment_id}@novamed",
        f"DTSTAMP:{datetime.now().strftime(fmt)}",
        f"DTSTART;TZID=Europe/Warsaw:{start.strftime(fmt)}",
        f"DTEND;TZID=Europe/Warsaw:{end.strftime(fmt)}",
        f"SUMMARY:{summary}",
        f"LOCATION:{location}",
        "DESCRIPTION:Szczegóły i ewentualne zmiany terminu w portalu NovaMed.",
        "BEGIN:VALARM",
        "TRIGGER:-PT24H",
        "ACTION:DISPLAY",
        "DESCRIPTION:Przypomnienie o wizycie",
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
    ])
    return Response(
        content=ics,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="wizyta-{a.appointment_id}.ics"'},
    )


@router.get("/appointments/{appointment_id}", response_model=AppointmentOut)
def appointment_detail(
    appointment_id: UUID,
    user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Szczegóły wizyty: uczestnik (pacjent/lekarz wizyty) lub personel placówki."""
    a = get_appointment_or_404(appointment_id, db)
    role = user.role.role_name
    is_participant = user.user_id in (a.patient_id, a.doctor_id)
    if not is_participant:
        if role not in ("rejestracja", "kierownik", "administrator", "pielegniarka"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Brak dostępu do tej wizyty.")
        assert_staff_in_clinic(db, user, a.clinic_id)  # personel tylko ze swojej placówki
    return appointment_out(db, a)


@router.post("/appointments/{appointment_id}/status", response_model=AppointmentOut)
def change_status(
    appointment_id: UUID,
    body: StatusChangeIn,
    user: AppUser = Depends(require_roles("lekarz", "rejestracja", "kierownik", "administrator")),
    db: Session = Depends(get_db),
):
    """Przebieg wizyty po stronie personelu: CONFIRMED→IN_PROGRESS→COMPLETED,
    NO_SHOW, INTERRUPTED — przejścia pilnuje maszyna stanów."""
    a = get_appointment_or_404(appointment_id, db)
    if user.role.role_name == "lekarz" and a.doctor_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="To nie jest wizyta tego lekarza.")
    # idempotencja: ustawienie statusu, który już obowiązuje = no-op (nie błąd).
    # Chroni przed podwójnym kliknięciem / wyścigiem „Rozpocznij" z dwóch widoków
    # (np. Mój dzień nawiguje do gabinetu, oba próbują ustawić IN_PROGRESS).
    if a.appointment_status == body.new_status.value:
        return appointment_out(db, a)
    assert_transition(a.appointment_status, body.new_status)
    # tylko JEDNA wizyta w toku na lekarza — przed rozpoczęciem kolejnej trzeba
    # bieżącą wstrzymać (pauza) albo zakończyć
    if body.new_status == AppointmentStatus.IN_PROGRESS and a.doctor_id is not None:
        other = db.scalar(select(Appointment).where(
            Appointment.doctor_id == a.doctor_id,
            Appointment.appointment_status == AppointmentStatus.IN_PROGRESS.value,
            Appointment.appointment_id != a.appointment_id,
        ))
        if other is not None:
            p = db.get(Patient, other.patient_id) if other.patient_id else None
            who = f"{p.first_name} {p.last_name}" if p else "inny pacjent"
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Masz już wizytę w toku ({who}). Wstrzymaj ją lub zakończ, zanim rozpoczniesz kolejną.",
            )
    # spóźniony pacjent (NO_SHOW → IN_PROGRESS) tylko w dniu wizyty —
    # po północy nieodbyta wizyta zostaje nieodbyta
    if (a.appointment_status == AppointmentStatus.NO_SHOW.value
            and a.appointment_datetime.date() != datetime.now().date()):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Wizytę oznaczoną jako nieodbytą można podjąć tylko w dniu wizyty.",
        )
    a.appointment_status = body.new_status.value
    # zakończenie wizyty auto-podpisuje szkic noty (nic nie zostaje niepodpisane)
    if body.new_status == AppointmentStatus.COMPLETED:
        from app.api.notes import autosign_note  # import lokalny — unika cyklu
        autosign_note(db, a.appointment_id)
    db.commit()
    return appointment_out(db, a)
