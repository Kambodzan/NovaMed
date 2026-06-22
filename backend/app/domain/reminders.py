# Przypomnienia o wizytach (UC-P7) + sprzątanie porzuconych płatności.
# Wywoływane pętlą w lifespan aplikacji (main.py) lub ręcznie w testach.
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domain.appointments import AppointmentStatus
from app.domain.coreservation import restore_blocked
from app.domain import messages
from app.domain.notify import notify
from app.domain.confirm import confirm_link, ensure_confirm_token
from app.models import Appointment, AppUser, Clinic, Payment


def send_due_reminders(db: Session) -> int:
    """Wysyła przypomnienia dla potwierdzonych wizyt w oknie najbliższych 24h —
    o ile placówka nie ma trybu NONE."""
    now = datetime.now()
    rows = db.scalars(
        select(Appointment)
        .join(Clinic, Clinic.clinic_id == Appointment.clinic_id)
        .where(
            Clinic.reminder_mode != "NONE",
            Appointment.appointment_status == AppointmentStatus.CONFIRMED.value,
            Appointment.patient_id.is_not(None),
            Appointment.reminder_sent.is_(False),
            Appointment.appointment_datetime > now,
            Appointment.appointment_datetime <= now + timedelta(hours=24),
        )
    ).all()
    for a in rows:
        doctor_user = db.get(AppUser, a.doctor_id) if a.doctor_id else None
        who = doctor_user.username if doctor_user else f"badanie {a.service_name}"
        join = confirm_link(ensure_confirm_token(a)) if a.appointment_type == "ONLINE" else None
        notify(db, a.patient_id, *messages.visit_reminder(
            who, a.appointment_datetime, join_link=join), email=True)
        a.reminder_sent = True
    db.commit()
    return len(rows)


def send_imminent_teleporada_links(db: Session, *, minutes_before: int = 15) -> int:
    """Tuż przed teleporadą (okno `minutes_before`) pacjent dostaje SMS/mail z linkiem
    do dołączenia — gdy jest najbardziej potrzebny (osobne od 24h). Raz na wizytę."""
    now = datetime.now()
    rows = db.scalars(
        select(Appointment).where(
            Appointment.appointment_type == "ONLINE",
            Appointment.appointment_status == AppointmentStatus.CONFIRMED.value,
            Appointment.patient_id.is_not(None),
            Appointment.teleporada_link_sent.is_(False),
            Appointment.appointment_datetime > now,
            Appointment.appointment_datetime <= now + timedelta(minutes=minutes_before),
        )
    ).all()
    for a in rows:
        doctor_user = db.get(AppUser, a.doctor_id) if a.doctor_id else None
        who = doctor_user.username if doctor_user else (a.service_name or "teleporada")
        join = confirm_link(ensure_confirm_token(a))
        notify(db, a.patient_id, *messages.teleporada_soon(
            who, a.appointment_datetime, join_link=join, minutes=minutes_before), email=True)
        a.teleporada_link_sent = True
    db.commit()
    return len(rows)


def send_confirmation_requests(db: Session) -> int:
    """Potwierdzanie obecności: gdy placówka tego wymaga, X godzin przed wizytą
    pacjent dostaje prośbę „potwierdź, że będziesz". Brak potwierdzenia jest
    widoczny dla personelu (bez auto-anulowania)."""
    now = datetime.now()
    rows = db.execute(
        select(Appointment, Clinic)
        .join(Clinic, Clinic.clinic_id == Appointment.clinic_id)
        .where(
            Clinic.confirmation_required.is_(True),
            Appointment.appointment_status == AppointmentStatus.CONFIRMED.value,
            Appointment.patient_id.is_not(None),
            Appointment.confirmation_requested.is_(False),
            Appointment.appointment_datetime > now,
        )
    ).all()
    sent = 0
    for a, clinic in rows:
        if a.appointment_datetime > now + timedelta(hours=clinic.confirmation_hours):
            continue
        who = (db.get(AppUser, a.doctor_id).username if a.doctor_id else a.service_name)
        link = confirm_link(ensure_confirm_token(a))
        notify(db, a.patient_id, *messages.confirm_request(
            who, a.appointment_datetime, link=link, clinic_name=clinic.clinic_name))
        a.confirmation_requested = True
        sent += 1
    db.commit()
    return sent


def release_expired_temp_locks(db: Session) -> int:
    """Porzucona płatność: TEMP_LOCK starszy niż temp_lock_minutes wraca do puli
    (FREE), płatność oznaczana FAILED, pacjent dostaje powiadomienie. Bez tego
    slot zablokowany zamkniętą przeglądarką wisiałby zajęty w nieskończoność."""
    from app.api.appointments import notify_earlier_watchers, visit_label  # import lokalny — unika cyklu

    cutoff = datetime.now() - timedelta(minutes=settings.temp_lock_minutes)
    rows = db.execute(
        select(Appointment, Payment)
        .join(Payment, Payment.appointment_id == Appointment.appointment_id)
        .where(
            Appointment.appointment_status == AppointmentStatus.TEMP_LOCK.value,
            Payment.payment_status == "PENDING",
            Payment.created_at < cutoff,
        )
    ).all()
    for a, payment in rows:
        payment.payment_status = "FAILED"
        patient_id = a.patient_id
        label = visit_label(db, a)
        a.appointment_status = AppointmentStatus.FREE.value
        a.patient_id = None
        a.notify_earlier = False
        restore_blocked(db, a)
        if patient_id:
            notify(db, patient_id, *messages.reservation_expired(label, settings.temp_lock_minutes), sms=False)
        notify_earlier_watchers(db, doctor_id=a.doctor_id, clinic_id=a.clinic_id, slot_dts=[a.appointment_datetime])

    # porzucone HOLD-y: ktoś otworzył formularz rezerwacji i nie dokończył (TEMP_LOCK
    # bez pacjenta i bez płatności) — po lock_expires_at slot wraca do puli
    holds = db.scalars(
        select(Appointment).where(
            Appointment.appointment_status == AppointmentStatus.TEMP_LOCK.value,
            Appointment.patient_id.is_(None),
            Appointment.lock_expires_at.is_not(None),
            Appointment.lock_expires_at < datetime.now(),
        )
    ).all()
    for a in holds:
        a.appointment_status = AppointmentStatus.FREE.value
        a.lock_expires_at = None
        a.confirmation_token = None
        restore_blocked(db, a)
        notify_earlier_watchers(db, doctor_id=a.doctor_id, clinic_id=a.clinic_id, slot_dts=[a.appointment_datetime])

    db.commit()
    return len(rows) + len(holds)
