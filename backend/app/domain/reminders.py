# Przypomnienia o wizytach (UC-P7): powiadomienie 24h przed terminem.
# Wywoływane pętlą w lifespan aplikacji (main.py) lub ręcznie w testach.
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.appointments import AppointmentStatus
from app.domain.notify import notify
from app.models import Appointment, AppUser


def send_due_reminders(db: Session) -> int:
    """Wysyła przypomnienia dla potwierdzonych wizyt w oknie najbliższych 24h."""
    now = datetime.now()
    rows = db.scalars(select(Appointment).where(
        Appointment.appointment_status == AppointmentStatus.CONFIRMED.value,
        Appointment.patient_id.is_not(None),
        Appointment.reminder_sent.is_(False),
        Appointment.appointment_datetime > now,
        Appointment.appointment_datetime <= now + timedelta(hours=24),
    )).all()
    for a in rows:
        doctor_user = db.get(AppUser, a.doctor_id)
        notify(
            db, a.patient_id,
            "Przypomnienie o wizycie",
            f"Jutro masz wizytę: {doctor_user.username}, "
            f"{a.appointment_datetime.strftime('%d.%m.%Y %H:%M')}"
            f"{' (teleporada — połączysz się z portalu)' if a.appointment_type == 'ONLINE' else ''}.",
        )
        a.reminder_sent = True
    db.commit()
    return len(rows)
