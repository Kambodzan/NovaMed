# Miękka rezerwacja terminu („hold") na czas wypełniania formularza — wspólna logika
# dla rezerwacji publicznej (gość), panelu pacjenta i rejestracji. Wejście w formularz
# blokuje slot dla pozostałych (FREE→TEMP_LOCK bez pacjenta/płatności), z blokadą wiersza
# (FOR UPDATE) która serializuje równoczesne próby i zamyka wyścig check-then-set.
#
from datetime import datetime, timedelta
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domain.appointments import AppointmentStatus
from app.domain.confirm import ensure_confirm_token
from app.models import Appointment


def acquire_hold(db: Session, appointment_id: UUID) -> Appointment:
    """FREE→TEMP_LOCK z blokadą wiersza; ustawia token holdu i lock_expires_at.
    NIE commituje — robi to wywołujący endpoint. 404/409 przy braku/zajętości."""
    a = db.get(Appointment, appointment_id, with_for_update=True)
    if a is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Termin nie istnieje.")
    if a.appointment_status != AppointmentStatus.FREE.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ktoś właśnie zajął ten termin — wybierz inny.")
    if a.appointment_datetime < datetime.now():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ten termin już minął — wybierz inny.")
    a.appointment_status = AppointmentStatus.TEMP_LOCK.value
    a.lock_expires_at = datetime.now() + timedelta(minutes=settings.slot_hold_minutes)
    ensure_confirm_token(a)
    return a


def release_hold(db: Session, appointment_id: UUID, token: str) -> bool:
    """Zwolnienie holdu (TEMP_LOCK bez pacjenta) — tylko zgodnym tokenem. NIE commituje."""
    a = db.get(Appointment, appointment_id, with_for_update=True)
    if (a is not None and a.appointment_status == AppointmentStatus.TEMP_LOCK.value
            and a.patient_id is None and a.confirmation_token == token):
        a.appointment_status = AppointmentStatus.FREE.value
        a.lock_expires_at = None
        a.confirmation_token = None
        return True
    return False


def held_by(a: Appointment, token: str | None) -> bool:
    """Czy slot jest holdem (TEMP_LOCK bez pacjenta) trzymanym przez TEN token i nie wygasł."""
    return bool(
        token is not None
        and a.appointment_status == AppointmentStatus.TEMP_LOCK.value
        and a.patient_id is None
        and a.confirmation_token is not None
        and a.confirmation_token == token
        and (a.lock_expires_at is None or a.lock_expires_at > datetime.now())
    )
