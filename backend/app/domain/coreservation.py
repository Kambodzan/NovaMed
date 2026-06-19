# Współrezerwacja: lekarz to zasób czasu. Gdy zajmie (rezerwacja/hold) termin na
# usługę X o danej godzinie, jego WOLNE sloty na inne usługi nakładające się czasowo
# (np. USG, pakiet) idą w stan BLOCKED i znikają z puli. Po zwolnieniu tamtego
# terminu (odwołanie/wygaśnięcie/odmowa płatności) wracają do FREE.
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.appointments import AppointmentStatus
from app.models import Appointment

DEFAULT_DURATION_MIN = 15


def _interval(a: Appointment):
    dur = a.duration_min or DEFAULT_DURATION_MIN
    return a.appointment_datetime, a.appointment_datetime + timedelta(minutes=dur)


def block_overlapping(db: Session, a: Appointment) -> None:
    """Zajęto termin `a` u lekarza → jego WOLNE, nakładające się czasowo sloty → BLOCKED.
    Działa tylko dla slotów USŁUGOWYCH (z `duration_min`) — legacy/zwykłych terminów
    bez czasu trwania nie rusza, więc nie zmienia dotychczasowego zachowania."""
    if a.doctor_id is None or a.duration_min is None:
        return  # bez lekarza albo bez czasu trwania → brak współrezerwacji
    start, end = _interval(a)
    others = db.scalars(select(Appointment).where(
        Appointment.doctor_id == a.doctor_id,
        Appointment.appointment_id != a.appointment_id,
        Appointment.appointment_status == AppointmentStatus.FREE.value,
        Appointment.duration_min.is_not(None),
    )).all()
    for s in others:
        s_start, s_end = _interval(s)
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
