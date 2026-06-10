from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.appointments import router as appointments_router
from app.api.auth import router as auth_router
from app.api.clinics import router as clinics_router
from app.api.documents import router as documents_router
from app.core.config import settings
from app.core.db import get_db

app = FastAPI(title=settings.app_name)
app.include_router(auth_router)
app.include_router(clinics_router)
app.include_router(appointments_router)
app.include_router(documents_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "app": settings.app_name}


@app.get("/health/db")
def health_db(db: Session = Depends(get_db)) -> dict:
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "reachable"}
