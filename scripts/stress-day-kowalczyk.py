# Stress-test UI: jeden dzień dr Kowalczyk zapchany terminami (10:00–17:45 co 15 min).
# Zwykłe sloty (bez usługi) — placówka ma siatkę 15 min, więc wchodzą wprost.
# Idempotentny: kasuje wcześniejsze ZWYKŁE wolne sloty Kowalczyk tego dnia i wstawia od nowa
# (sloty usługowe z seeda zostawia nietknięte). Wymaga DB (działa bezpośrednio na sesji).
#   cd backend; .venv\Scripts\python.exe ..\scripts\stress-day-kowalczyk.py
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.core.db import SessionLocal  # noqa: E402
from app.models import AppUser, Appointment, Clinic  # noqa: E402
from sqlalchemy import select  # noqa: E402

DATE = datetime(2026, 7, 2)   # „2 lipca"
START_H, END_H, STEP_MIN = 10, 18, 15

db = SessionLocal()
doc = db.scalar(select(AppUser).where(AppUser.email == "a.kowalczyk@novamed.dev"))
clinic = db.scalar(select(Clinic).where(Clinic.clinic_name.like("%Piastów%")))
day0, day1 = DATE.replace(hour=0, minute=0), DATE.replace(hour=23, minute=59)

# usuń poprzednie ZWYKŁE (service_id NULL) wolne sloty tego lekarza tego dnia — idempotencja
old = db.scalars(select(Appointment).where(
    Appointment.doctor_id == doc.user_id,
    Appointment.appointment_status == "FREE",
    Appointment.service_id.is_(None),
    Appointment.appointment_datetime >= day0,
    Appointment.appointment_datetime <= day1,
)).all()
for a in old:
    db.delete(a)

n = 0
t = DATE.replace(hour=START_H)
while t.hour < END_H:
    db.add(Appointment(
        patient_id=None, doctor_id=doc.user_id, clinic_id=clinic.clinic_id,
        appointment_datetime=t, appointment_status="FREE", appointment_type="STATIONARY",
        allow_online=True, price=None, service_name=None, referral_required=False,
        service_id=None, duration_min=STEP_MIN,
    ))
    t += timedelta(minutes=STEP_MIN)
    n += 1

db.commit()
print(f"dr Kowalczyk @ {clinic.clinic_name}: usunieto {len(old)} starych, dodano {n} slotow "
      f"na {DATE.date()} ({START_H}:00–{END_H-1}:45 co {STEP_MIN} min)")
