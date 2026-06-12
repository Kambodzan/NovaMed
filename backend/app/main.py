import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.admin import router as admin_router
from app.api.appointments import router as appointments_router
from app.api.auth import router as auth_router
from app.api.clinics import router as clinics_router
from app.api.dictionaries import router as dictionaries_router
from app.api.documents import router as documents_router
from app.api.family import router as family_router
from app.api.integrations import router as integrations_router
from app.api.notifications import router as notifications_router
from app.api.procedures import router as procedures_router
from app.api.public import router as public_router
from app.api.reports import router as reports_router
from app.api.reviews import router as reviews_router
from app.api.shares import router as shares_router
from app.api.telemed import router as telemed_router
from app.api.waitlist import router as waitlist_router
from app.core.config import settings
from app.core.db import SessionLocal, get_db
from app.domain.reminders import release_expired_temp_locks, send_due_reminders

logger = logging.getLogger("novamed")


async def reminders_loop() -> None:
    """UC-P7: cykliczna wysyłka przypomnień o wizytach (okno 24h)
    + sprzątanie porzuconych płatności (TEMP_LOCK → FREE po temp_lock_minutes)."""
    while True:
        try:
            db = SessionLocal()
            try:
                sent = send_due_reminders(db)
                if sent:
                    logger.info("Wysłano %s przypomnień o wizytach", sent)
                released = release_expired_temp_locks(db)
                if released:
                    logger.info("Zwolniono %s terminów z porzuconą płatnością", released)
            finally:
                db.close()
        except Exception:  # pętla nie może umrzeć od pojedynczego błędu
            logger.exception("Błąd pętli przypomnień")
        await asyncio.sleep(settings.reminders_interval_seconds)


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(reminders_loop()) if settings.reminders_enabled else None
    yield
    if task:
        task.cancel()


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex,
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
app.include_router(telemed_router)
app.include_router(shares_router)
app.include_router(dictionaries_router)
app.include_router(family_router)
app.include_router(public_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "app": settings.app_name}


@app.get("/health/db")
def health_db(db: Session = Depends(get_db)) -> dict:
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "reachable"}
