import csv
import io
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import require_roles
from app.core.db import get_db
from app.domain.appointments import AppointmentStatus
from app.models import Appointment, AppUser, Clinic

router = APIRouter(tags=["reports"])

REPORT_ROLES = ("rejestracja", "kierownik", "administrator")


class DoctorLoadOut(BaseModel):
    doctor_id: int
    doctor_name: str
    booked: int
    completed: int


class ReportOut(BaseModel):
    month: str
    total_booked: int
    completed: int
    cancelled: int
    no_show: int
    online_share_pct: float
    per_doctor: list[DoctorLoadOut]


def month_range(month: str) -> tuple[datetime, datetime]:
    try:
        start = datetime.strptime(month, "%Y-%m")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Miesiąc w formacie YYYY-MM.") from exc
    end = datetime(start.year + 1, 1, 1) if start.month == 12 else datetime(start.year, start.month + 1, 1)
    return start, end


def build_report(db: Session, clinic_id: int, month: str) -> ReportOut:
    """UC-PP4: statystyki miesiąca. „Wizyta" = termin z przypisanym pacjentem
    (wolne sloty nie wchodzą do statystyk)."""
    if db.get(Clinic, clinic_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Placówka nie istnieje.")
    start, end = month_range(month)
    rows = db.scalars(select(Appointment).where(
        Appointment.clinic_id == clinic_id,
        Appointment.appointment_datetime >= start,
        Appointment.appointment_datetime < end,
        Appointment.patient_id.is_not(None),
    )).all()

    completed = sum(1 for a in rows if a.appointment_status == AppointmentStatus.COMPLETED.value)
    cancelled = sum(1 for a in rows if a.appointment_status == AppointmentStatus.CANCELLED.value)
    no_show = sum(1 for a in rows if a.appointment_status == AppointmentStatus.NO_SHOW.value)
    online = sum(1 for a in rows if a.appointment_type == "ONLINE")

    per_doctor: dict[int, DoctorLoadOut] = {}
    for a in rows:
        entry = per_doctor.get(a.doctor_id)
        if entry is None:
            doctor_user = db.get(AppUser, a.doctor_id)
            entry = DoctorLoadOut(doctor_id=a.doctor_id, doctor_name=doctor_user.username, booked=0, completed=0)
            per_doctor[a.doctor_id] = entry
        entry.booked += 1
        if a.appointment_status == AppointmentStatus.COMPLETED.value:
            entry.completed += 1

    return ReportOut(
        month=month,
        total_booked=len(rows),
        completed=completed,
        cancelled=cancelled,
        no_show=no_show,
        online_share_pct=round(100 * online / len(rows), 1) if rows else 0.0,
        per_doctor=sorted(per_doctor.values(), key=lambda d: -d.booked),
    )


@router.get("/clinics/{clinic_id}/reports", response_model=ReportOut)
def clinic_report(
    clinic_id: int,
    month: str = Query(description="Miesiąc w formacie YYYY-MM"),
    _: AppUser = Depends(require_roles(*REPORT_ROLES)),
    db: Session = Depends(get_db),
):
    return build_report(db, clinic_id, month)


@router.get("/clinics/{clinic_id}/reports/csv", response_class=PlainTextResponse)
def clinic_report_csv(
    clinic_id: int,
    month: str = Query(description="Miesiąc w formacie YYYY-MM"),
    _: AppUser = Depends(require_roles(*REPORT_ROLES)),
    db: Session = Depends(get_db),
):
    """Eksport raportu do CSV (UC-PP4; PDF — etap szlifu M10)."""
    report = build_report(db, clinic_id, month)
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(["Raport placówki", f"miesiąc {report.month}"])
    w.writerow([])
    w.writerow(["Wizyty (z pacjentem)", report.total_booked])
    w.writerow(["Zakończone", report.completed])
    w.writerow(["Odwołane", report.cancelled])
    w.writerow(["Nieodbyte (no-show)", report.no_show])
    w.writerow(["Udział teleporad [%]", report.online_share_pct])
    w.writerow([])
    w.writerow(["Lekarz", "Wizyty", "Zakończone"])
    for d in report.per_doctor:
        w.writerow([d.doctor_name, d.booked, d.completed])
    return PlainTextResponse(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="raport-{report.month}.csv"'},
    )
