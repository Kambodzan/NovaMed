from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.admin import router as admin_router
from app.api.appointments import router as appointments_router
from app.api.auth import router as auth_router
from app.api.clinics import router as clinics_router
from app.api.documents import router as documents_router
from app.api.integrations import router as integrations_router
from app.api.notifications import router as notifications_router
from app.api.procedures import router as procedures_router
from app.api.reports import router as reports_router
from app.api.reviews import router as reviews_router
from app.api.waitlist import router as waitlist_router
from app.core.config import settings
from app.core.db import get_db

app = FastAPI(title=settings.app_name)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)
app.include_router(clinics_router)
app.include_router(appointments_router)
app.include_router(documents_router)
app.include_router(procedures_router)
app.include_router(reports_router)
app.include_router(integrations_router)
app.include_router(notifications_router)
app.include_router(reviews_router)
app.include_router(waitlist_router)
app.include_router(admin_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "app": settings.app_name}


@app.get("/health/db")
def health_db(db: Session = Depends(get_db)) -> dict:
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "reachable"}
