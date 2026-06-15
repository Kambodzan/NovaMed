from uuid import UUID
import csv
import io
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import require_roles
from app.core.db import get_db
from app.domain.appointments import AppointmentStatus
from app.domain.pdf import render_report_pdf
from app.models import Appointment, AppUser, Clinic

router = APIRouter(tags=["reports"])

REPORT_ROLES = ("rejestracja", "kierownik", "administrator")


class DoctorLoadOut(BaseModel):
    doctor_id: UUID
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


def resolve_period(month: str | None, date_from: str | None, date_to: str | None) -> tuple[datetime, datetime, str]:
    """Okres raportu: miesiąc (YYYY-MM) albo dowolny zakres od–do (włącznie)."""
    if date_from and date_to:
        try:
            start = datetime.fromisoformat(date_from)
            end = datetime.fromisoformat(date_to) + timedelta(days=1)  # „do" włącznie
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Daty w formacie YYYY-MM-DD.") from exc
        if end <= start:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Data końca zakresu jest przed datą początku.")
        return start, end, f"{date_from} — {date_to}"
    if month:
        start, end = month_range(month)
        return start, end, month
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Podaj miesiąc (month) albo zakres (from/to).")


def build_report(db: Session, clinic_id: UUID, month: str | None = None,
                 date_from: str | None = None, date_to: str | None = None) -> ReportOut:
    """UC-PP4: statystyki okresu. „Wizyta" = termin z przypisanym pacjentem
    (wolne sloty nie wchodzą do statystyk)."""
    if db.get(Clinic, clinic_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Placówka nie istnieje.")
    start, end, label = resolve_period(month, date_from, date_to)
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

    per_doctor: dict[UUID, DoctorLoadOut] = {}
    for a in rows:
        if a.doctor_id is None:
            continue  # badania (pracownia) nie mają lekarza — poza obłożeniem lekarzy
        entry = per_doctor.get(a.doctor_id)
        if entry is None:
            doctor_user = db.get(AppUser, a.doctor_id)
            entry = DoctorLoadOut(doctor_id=a.doctor_id, doctor_name=doctor_user.username, booked=0, completed=0)
            per_doctor[a.doctor_id] = entry
        entry.booked += 1
        if a.appointment_status == AppointmentStatus.COMPLETED.value:
            entry.completed += 1

    return ReportOut(
        month=label,
        total_booked=len(rows),
        completed=completed,
        cancelled=cancelled,
        no_show=no_show,
        online_share_pct=round(100 * online / len(rows), 1) if rows else 0.0,
        per_doctor=sorted(per_doctor.values(), key=lambda d: -d.booked),
    )


@router.get("/clinics/{clinic_id}/reports", response_model=ReportOut)
def clinic_report(
    clinic_id: UUID,
    month: str | None = Query(default=None, description="Miesiąc YYYY-MM (albo from/to)"),
    date_from: str | None = Query(default=None, alias="from", description="Początek zakresu YYYY-MM-DD"),
    date_to: str | None = Query(default=None, alias="to", description="Koniec zakresu (włącznie) YYYY-MM-DD"),
    _: AppUser = Depends(require_roles(*REPORT_ROLES)),
    db: Session = Depends(get_db),
):
    return build_report(db, clinic_id, month, date_from, date_to)


@router.get("/clinics/{clinic_id}/reports/csv", response_class=PlainTextResponse)
def clinic_report_csv(
    clinic_id: UUID,
    month: str | None = Query(default=None),
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    _: AppUser = Depends(require_roles(*REPORT_ROLES)),
    db: Session = Depends(get_db),
):
    """Eksport raportu do CSV (UC-PP4)."""
    report = build_report(db, clinic_id, month, date_from, date_to)
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
        headers={"Content-Disposition": f'attachment; filename="raport-{_fname(report.month)}.csv"'},
    )


@router.get("/clinics/{clinic_id}/reports/pdf")
def clinic_report_pdf(
    clinic_id: UUID,
    month: str | None = Query(default=None),
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    _: AppUser = Depends(require_roles(*REPORT_ROLES)),
    db: Session = Depends(get_db),
):
    """Eksport raportu poradni do PDF (UC-PP4)."""
    report = build_report(db, clinic_id, month, date_from, date_to)
    clinic = db.get(Clinic, clinic_id)
    pdf = render_report_pdf(
        clinic_name=clinic.clinic_name, month=report.month,
        total_booked=report.total_booked, completed=report.completed,
        cancelled=report.cancelled, no_show=report.no_show,
        online_share_pct=report.online_share_pct,
        per_doctor=[(d.doctor_name, d.booked, d.completed) for d in report.per_doctor],
    )
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="raport-{_fname(report.month)}.pdf"'},
    )


def _fname(label: str) -> str:
    """Etykieta okresu → bezpieczny fragment nazwy pliku."""
    return "".join(c if c.isalnum() else "_" for c in label).strip("_")
