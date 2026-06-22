# Współrezerwacja: lekarz to zasób czasu. Gdy zajmie (rezerwacja/hold) termin na
# usługę X o danej godzinie, jego WOLNE sloty na inne usługi nakładające się czasowo
# (np. USG, pakiet) idą w stan BLOCKED i znikają z puli. Po zwolnieniu tamtego
# terminu (odwołanie/wygaśnięcie/odmowa płatności) wracają do FREE.
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.appointments import AppointmentStatus
from app.models import Appointment, Clinic, Doctor

DEFAULT_DURATION_MIN = 15


def _effective_minutes(db: Session, a: Appointment) -> int:
    """Czas trwania slotu: z usługi (`duration_min`), a dla zwykłej wizyty bez czasu —
    efektywnie krok siatki lekarza/placówki (tyle realnie zajmuje wizyta)."""
    if a.duration_min:
        return a.duration_min
    if a.doctor_id:
        doc = db.get(Doctor, a.doctor_id)
        if doc and doc.slot_duration_min:
            return doc.slot_duration_min
    if a.clinic_id:
        c = db.get(Clinic, a.clinic_id)
        if c and c.slot_interval_min:
            return c.slot_interval_min
    return DEFAULT_DURATION_MIN


def _interval(db: Session, a: Appointment):
    return a.appointment_datetime, a.appointment_datetime + timedelta(minutes=_effective_minutes(db, a))


def block_overlapping(db: Session, a: Appointment) -> None:
    """Zajęto termin `a` u lekarza → jego WOLNE, nakładające się czasowo sloty → BLOCKED.
    Obejmuje też zwykłe wizyty bez `duration_min` (efektywny czas = siatka lekarza/
    placówki), żeby miks „zwykła wizyta + usługa" na tę samą godzinę też się synchronizował
    — lekarz to jeden zasób czasu i nie przyjmie dwóch pacjentów naraz."""
    if a.doctor_id is None:
        return
    start, end = _interval(db, a)
    day_start = a.appointment_datetime.replace(hour=0, minute=0, second=0, microsecond=0)
    others = db.scalars(select(Appointment).where(
        Appointment.doctor_id == a.doctor_id,
        Appointment.appointment_id != a.appointment_id,
        Appointment.appointment_status == AppointmentStatus.FREE.value,
        Appointment.appointment_datetime >= day_start,
        Appointment.appointment_datetime < day_start + timedelta(days=1),
    )).all()
    for s in others:
        s_start, s_end = _interval(db, s)
        if s_start < end and start < s_end:  # przedziały [start,end) się nakładają
            s.appointment_status = AppointmentStatus.BLOCKED.value
            s.blocked_by_id = a.appointment_id


def restore_blocked(db: Session, a: Appointment) -> None:
    """Termin `a` zwolniony → sloty, które przez niego były BLOCKED, wracają do puli."""
    for s in db.scalars(select(Appointment).where(
        Appointment.blocked_by_id == a.appointment_id,
        Appointment.appointment_status == AppointmentStatus.BLOCKED.value,
    )).all():
        s.appointment_status = AppointmentStatus.FREE.value
        s.blocked_by_id = None
