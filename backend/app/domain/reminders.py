# Przypomnienia o wizytach (UC-P7) + sprzątanie porzuconych płatności.
# Wywoływane pętlą w lifespan aplikacji (main.py) lub ręcznie w testach.
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domain.appointments import AppointmentStatus
from app.domain.notify import notify
from app.models import Appointment, AppUser, Clinic, Payment


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
        doctor_user = db.get(AppUser, a.doctor_id) if a.doctor_id else None
        who = doctor_user.username if doctor_user else f"badanie {a.service_name}"
        notify(
            db, a.patient_id,
            "Przypomnienie o wizycie",
            f"Jutro masz wizytę: {who}, "
            f"{a.appointment_datetime.strftime('%d.%m.%Y %H:%M')}"
            f"{' (teleporada — połączysz się z portalu)' if a.appointment_type == 'ONLINE' else ''}.",
        )
        a.reminder_sent = True
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
        notify(
            db, a.patient_id,
            "Potwierdź swoją wizytę",
            f"Wizyta: {who}, {a.appointment_datetime.strftime('%d.%m.%Y %H:%M')} ({clinic.clinic_name}). "
            "Potwierdź obecność w Moich wizytach — albo odwołaj, by zwolnić termin innym.",
        )
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
        if patient_id:
            notify(db, patient_id, "Rezerwacja wygasła",
                   f"Płatność za wizytę ({label}) nie została dokończona w {settings.temp_lock_minutes} min "
                   "— termin wrócił do puli. Jeśli nadal chcesz, zarezerwuj go ponownie.")
        notify_earlier_watchers(db, doctor_id=a.doctor_id, clinic_id=a.clinic_id, slot_dts=[a.appointment_datetime])
    db.commit()
    return len(rows)
