from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_roles
from app.core.db import get_db
from app.domain.appointments import (
    CANCEL_MIN_HOURS,
    AppointmentStatus,
    AppointmentType,
    assert_transition,
)
from app.models import Appointment, AppUser, Clinic, Doctor, Patient, StaffClinic

router = APIRouter(tags=["appointments"])

SLOT_MANAGERS = ("lekarz", "rejestracja", "kierownik", "administrator")


class SlotsCreateIn(BaseModel):
    doctor_id: int
    datetimes: list[datetime]
    appointment_type: AppointmentType = AppointmentType.STATIONARY


class AppointmentOut(BaseModel):
    appointment_id: int
    appointment_datetime: datetime
    appointment_status: str
    appointment_type: str
    doctor_id: int
    doctor_name: str
    specialization: str | None
    clinic_id: int
    clinic_name: str
    patient_id: int | None = None
    patient_name: str | None = None


class RescheduleIn(BaseModel):
    new_appointment_id: int


class StatusChangeIn(BaseModel):
    new_status: AppointmentStatus


def appointment_out(db: Session, a: Appointment) -> AppointmentOut:
    doctor_user = db.get(AppUser, a.doctor_id)
    doctor = db.get(Doctor, a.doctor_id)
    clinic = db.get(Clinic, a.clinic_id)
    patient = db.get(Patient, a.patient_id) if a.patient_id else None
    return AppointmentOut(
        appointment_id=a.appointment_id,
        appointment_datetime=a.appointment_datetime,
        appointment_status=a.appointment_status,
        appointment_type=a.appointment_type,
        doctor_id=a.doctor_id,
        doctor_name=doctor_user.username,
        specialization=doctor.specialization,
        clinic_id=a.clinic_id,
        clinic_name=clinic.clinic_name,
        patient_id=a.patient_id,
        patient_name=f"{patient.first_name} {patient.last_name}" if patient else None,
    )


def get_appointment_or_404(appointment_id: int, db: Session) -> Appointment:
    a = db.get(Appointment, appointment_id)
    if a is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wizyta nie istnieje.")
    return a


@router.post("/clinics/{clinic_id}/slots", status_code=status.HTTP_201_CREATED, response_model=list[AppointmentOut])
def create_slots(
    clinic_id: int,
    body: SlotsCreateIn,
    user: AppUser = Depends(require_roles(*SLOT_MANAGERS)),
    db: Session = Depends(get_db),
):
    """UC-PP2 / sekwencja-dodanie-terminow: nowe wolne terminy (FREE, patient_id NULL)."""
    if db.get(Clinic, clinic_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Placówka nie istnieje.")
    if db.get(Doctor, body.doctor_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lekarz nie istnieje.")
    # lekarz może dodawać terminy tylko sobie
    if user.role.role_name == "lekarz" and user.user_id != body.doctor_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Lekarz może dodawać terminy tylko w swoim kalendarzu.")
    works_here = db.scalar(select(StaffClinic).where(
        StaffClinic.clinic_id == clinic_id,
        StaffClinic.user_id == body.doctor_id,
        StaffClinic.end_date.is_(None),
    ))
    if not works_here:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Lekarz nie jest przypisany do tej placówki.")

    created: list[Appointment] = []
    for dt in body.datetimes:
        conflict = db.scalar(select(Appointment).where(
            Appointment.doctor_id == body.doctor_id,
            Appointment.appointment_datetime == dt,
            Appointment.appointment_status.notin_([
                AppointmentStatus.CANCELLED.value, AppointmentStatus.INTERRUPTED.value,
            ]),
        ))
        if conflict:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Lekarz ma już termin {dt.isoformat(sep=' ', timespec='minutes')}.",
            )
        a = Appointment(
            patient_id=None,
            doctor_id=body.doctor_id,
            clinic_id=clinic_id,
            appointment_datetime=dt,
            appointment_status=AppointmentStatus.FREE.value,
            appointment_type=body.appointment_type.value,
        )
        db.add(a)
        created.append(a)
    db.commit()
    return [appointment_out(db, a) for a in created]


@router.get("/slots", response_model=list[AppointmentOut])
def search_slots(
    db: Session = Depends(get_db),
    _: AppUser = Depends(get_current_user),
    specialization: str | None = None,
    doctor_id: int | None = Query(default=None),
    clinic_id: int | None = Query(default=None),
):
    """UC-P3: wyszukiwanie wolnych terminów (kalendarz pacjenta)."""
    q = (
        select(Appointment)
        .join(Doctor, Doctor.doctor_id == Appointment.doctor_id)
        .where(Appointment.appointment_status == AppointmentStatus.FREE.value)
        .order_by(Appointment.appointment_datetime)
    )
    if specialization:
        q = q.where(Doctor.specialization == specialization)
    if doctor_id:
        q = q.where(Appointment.doctor_id == doctor_id)
    if clinic_id:
        q = q.where(Appointment.clinic_id == clinic_id)
    return [appointment_out(db, a) for a in db.scalars(q)]


@router.post("/appointments/{appointment_id}/book", response_model=AppointmentOut)
def book_appointment(
    appointment_id: int,
    user: AppUser = Depends(require_roles("pacjent")),
    db: Session = Depends(get_db),
):
    """UC-P3: rezerwacja wolnego terminu. Bez płatności (płatności: M6 — wtedy
    FREE→TEMP_LOCK→CONFIRMED); na razie FREE→CONFIRMED."""
    a = get_appointment_or_404(appointment_id, db)
    if a.appointment_status != AppointmentStatus.FREE.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ten termin nie jest już dostępny.")
    assert_transition(a.appointment_status, AppointmentStatus.CONFIRMED)
    a.patient_id = user.user_id
    a.appointment_status = AppointmentStatus.CONFIRMED.value
    db.commit()
    return appointment_out(db, a)


@router.post("/appointments/{appointment_id}/cancel", response_model=AppointmentOut)
def cancel_appointment(
    appointment_id: int,
    user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """UC-P10: anulowanie. Polityka 24 h dla pacjenta; personel może zawsze.
    Jeśli jest jeszcze czas, termin wraca do puli jako NOWY wolny slot
    (historia odwołanej wizyty zostaje) — zgodnie z diagramem stanów wizyty."""
    a = get_appointment_or_404(appointment_id, db)
    is_patient = user.role.role_name == "pacjent"
    if is_patient and a.patient_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="To nie jest Twoja wizyta.")

    hours_left = (a.appointment_datetime - datetime.now()).total_seconds() / 3600
    if is_patient and hours_left < CANCEL_MIN_HOURS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Wizyty nie można anulować na mniej niż {CANCEL_MIN_HOURS} h przed terminem. Skontaktuj się z rejestracją.",
        )

    assert_transition(a.appointment_status, AppointmentStatus.CANCELLED)
    a.appointment_status = AppointmentStatus.CANCELLED.value

    # zwrot terminu do puli, jeśli wizyta jeszcze przed czasem
    if hours_left > 0:
        db.add(Appointment(
            patient_id=None,
            doctor_id=a.doctor_id,
            clinic_id=a.clinic_id,
            appointment_datetime=a.appointment_datetime,
            appointment_status=AppointmentStatus.FREE.value,
            appointment_type=a.appointment_type,
        ))
    db.commit()
    return appointment_out(db, a)


@router.post("/appointments/{appointment_id}/reschedule", response_model=AppointmentOut)
def reschedule_appointment(
    appointment_id: int,
    body: RescheduleIn,
    user: AppUser = Depends(require_roles("pacjent")),
    db: Session = Depends(get_db),
):
    """UC-P9: przełożenie = rezerwacja nowego slotu + zwolnienie starego (ta sama polityka 24 h)."""
    old = get_appointment_or_404(appointment_id, db)
    if old.patient_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="To nie jest Twoja wizyta.")
    new = get_appointment_or_404(body.new_appointment_id, db)
    if new.appointment_status != AppointmentStatus.FREE.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Wybrany nowy termin nie jest już dostępny.")

    hours_left = (old.appointment_datetime - datetime.now()).total_seconds() / 3600
    if hours_left < CANCEL_MIN_HOURS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Wizyty nie można przełożyć na mniej niż {CANCEL_MIN_HOURS} h przed terminem.",
        )

    assert_transition(old.appointment_status, AppointmentStatus.CANCELLED)
    old.appointment_status = AppointmentStatus.CANCELLED.value
    db.add(Appointment(
        patient_id=None,
        doctor_id=old.doctor_id,
        clinic_id=old.clinic_id,
        appointment_datetime=old.appointment_datetime,
        appointment_status=AppointmentStatus.FREE.value,
        appointment_type=old.appointment_type,
    ))
    new.patient_id = user.user_id
    new.appointment_status = AppointmentStatus.CONFIRMED.value
    db.commit()
    return appointment_out(db, new)


@router.get("/appointments/my", response_model=list[AppointmentOut])
def my_appointments(
    user: AppUser = Depends(require_roles("pacjent")),
    db: Session = Depends(get_db),
):
    """UC-P3/P4: lista wizyt pacjenta (bez wolnych slotów)."""
    rows = db.scalars(
        select(Appointment)
        .where(Appointment.patient_id == user.user_id)
        .order_by(Appointment.appointment_datetime.desc())
    )
    return [appointment_out(db, a) for a in rows]


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


@router.post("/appointments/{appointment_id}/status", response_model=AppointmentOut)
def change_status(
    appointment_id: int,
    body: StatusChangeIn,
    user: AppUser = Depends(require_roles("lekarz", "rejestracja", "kierownik", "administrator")),
    db: Session = Depends(get_db),
):
    """Przebieg wizyty po stronie personelu: CONFIRMED→IN_PROGRESS→COMPLETED,
    NO_SHOW, INTERRUPTED — przejścia pilnuje maszyna stanów."""
    a = get_appointment_or_404(appointment_id, db)
    if user.role.role_name == "lekarz" and a.doctor_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="To nie jest wizyta tego lekarza.")
    assert_transition(a.appointment_status, body.new_status)
    a.appointment_status = body.new_status.value
    db.commit()
    return appointment_out(db, a)
