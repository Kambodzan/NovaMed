# Ustawia/odnawia testową teleporadę Janina <-> dr Kowalczyk NA DZIŚ
# (status IN_PROGRESS — przyciski dołączenia widoczne u obu stron od razu).
# Użycie:  backend\.venv\Scripts\python.exe ..\scripts\demo-call.py   (z katalogu backend)
#    lub:  cd backend; .venv\Scripts\python.exe ..\scripts\demo-call.py
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models import Appointment, AppUser


def main() -> None:
    db = SessionLocal()

    def uid(email: str) -> int:
        return db.scalar(select(AppUser).where(AppUser.email == email)).user_id

    janina, kow = uid("janina.wisniewska@novamed.dev"), uid("a.kowalczyk@novamed.dev")
    dt = (datetime.now() + timedelta(minutes=30)).replace(second=0, microsecond=0)
    # jeśli +30 min przeskakuje za północ — zostaw na dziś 23:30
    if dt.date() != datetime.now().date():
        dt = datetime.now().replace(hour=23, minute=30, second=0, microsecond=0)

    existing = db.scalar(select(Appointment).where(
        Appointment.patient_id == janina,
        Appointment.doctor_id == kow,
        Appointment.appointment_type == "ONLINE",
        Appointment.appointment_status == "IN_PROGRESS",
    ))
    if existing:
        existing.appointment_datetime = dt
        visit_id = existing.appointment_id
    else:
        a = Appointment(
            patient_id=janina, doctor_id=kow, clinic_id=1,
            appointment_datetime=dt, appointment_status="IN_PROGRESS",
            appointment_type="ONLINE", reminder_sent=True,
        )
        db.add(a)
        db.flush()
        visit_id = a.appointment_id
    db.commit()
    # bez znaków spoza cp1250 — konsola Windows
    print(f"Teleporada testowa gotowa: wizyta #{visit_id}, dzis {dt.strftime('%H:%M')} (w trakcie).")
    print("Pacjentka: Moje wizyty -> Dolacz do wizyty | Lekarka: Moj dzien -> Wroc do rozmowy")
    db.close()


if __name__ == "__main__":
    main()
