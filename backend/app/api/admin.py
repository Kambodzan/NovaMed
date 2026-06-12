from uuid import UUID
import time
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.auth import require_roles
from app.core.config import settings
from app.core.db import get_db
from app.models import Appointment, AppUser, MedicalDocument, NursingProcedure, Payment, Role

router = APIRouter(prefix="/admin", tags=["admin"])

ADMIN = ("administrator",)


# ---------- użytkownicy (UC-A1) ----------

class AdminUserOut(BaseModel):
    user_id: UUID
    username: str
    email: str
    role: str
    active_account: bool
    created_at: datetime


@router.get("/users", response_model=list[AdminUserOut])
def list_users(
    q: str = "",
    _: AppUser = Depends(require_roles(*ADMIN)),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(AppUser, Role.role_name).join(Role, Role.role_id == AppUser.role_id)
        .order_by(AppUser.user_id)
    ).all()
    out = [
        AdminUserOut(
            user_id=u.user_id, username=u.username, email=u.email,
            role=role_name, active_account=u.active_account, created_at=u.created_at,
        )
        for u, role_name in rows
    ]
    if q:
        ql = q.lower()
        out = [u for u in out if ql in u.username.lower() or ql in u.email.lower() or ql in u.role.lower()]
    return out


@router.post("/users/{user_id}/toggle-active", response_model=AdminUserOut)
def toggle_active(
    user_id: UUID,
    admin: AppUser = Depends(require_roles(*ADMIN)),
    db: Session = Depends(get_db),
):
    """Blokada/odblokowanie konta. Zamiast usuwania (UC-A1 A1: konta z historią
    wizyt nie znikają — dezaktywacja zachowuje dokumentację)."""
    if user_id == admin.user_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Nie można zablokować własnego konta.")
    user = db.get(AppUser, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Użytkownik nie istnieje.")
    user.active_account = not user.active_account
    db.commit()
    return AdminUserOut(
        user_id=user.user_id, username=user.username, email=user.email,
        role=user.role.role_name, active_account=user.active_account, created_at=user.created_at,
    )


# ---------- integracje (UC-A2) ----------

class IntegrationStatusOut(BaseModel):
    id: str
    name: str
    url: str
    status: str       # OK / DOWN
    latency_ms: int | None
    env: str = "mock"


@router.get("/integrations", response_model=list[IntegrationStatusOut])
def integrations_status(_: AppUser = Depends(require_roles(*ADMIN))):
    """Status połączeń z systemami zewnętrznymi (mock-serwisy) — live ping /health."""
    services = [
        ("p1", "System P1 (e-recepty, e-skierowania)", settings.p1_base_url),
        ("zus", "ZUS e-ZLA (e-zwolnienia)", settings.zus_base_url),
        ("ewus", "eWUŚ (weryfikacja ubezpieczenia)", settings.ewus_base_url),
        ("lab", "Laboratorium diagnostyczne", settings.lab_base_url),
        ("payments", "Operator płatności", settings.payments_base_url),
    ]
    out = []
    for sid, name, url in services:
        started = time.perf_counter()
        try:
            resp = httpx.get(f"{url.rstrip('/')}/health", timeout=1.0)
            ok = resp.status_code == 200
            latency = int((time.perf_counter() - started) * 1000)
        except httpx.HTTPError:
            ok, latency = False, None
        out.append(IntegrationStatusOut(
            id=sid, name=name, url=url, status="OK" if ok else "DOWN", latency_ms=latency,
        ))
    return out


# ---------- monitoring (UC-A3) ----------

class AdminStatsOut(BaseModel):
    users_by_role: dict[str, int]
    appointments_total: int
    appointments_completed: int
    documents_total: int
    procedures_total: int
    payments_paid_total: float
    database: str


@router.get("/stats", response_model=AdminStatsOut)
def stats(_: AppUser = Depends(require_roles(*ADMIN)), db: Session = Depends(get_db)):
    by_role_rows = db.execute(
        select(Role.role_name, func.count(AppUser.user_id))
        .join(AppUser, AppUser.role_id == Role.role_id, isouter=True)
        .group_by(Role.role_name)
    ).all()
    paid = db.scalar(select(func.coalesce(func.sum(Payment.amount), 0)).where(Payment.payment_status == "PAID"))
    return AdminStatsOut(
        users_by_role={name: cnt for name, cnt in by_role_rows},
        appointments_total=db.scalar(select(func.count(Appointment.appointment_id))) or 0,
        appointments_completed=db.scalar(
            select(func.count(Appointment.appointment_id)).where(Appointment.appointment_status == "COMPLETED")
        ) or 0,
        documents_total=db.scalar(select(func.count(MedicalDocument.document_id))) or 0,
        procedures_total=db.scalar(select(func.count(NursingProcedure.procedure_id))) or 0,
        payments_paid_total=float(paid or 0),
        database="OK",
    )
