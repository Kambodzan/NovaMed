# Dziennik audytu RODO (NFR 8.2): rejestr dostępu personelu do danych
# medycznych pacjenta + zdarzeń wrażliwych (anonimizacja). „Kto, kiedy, co, czyje".
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class AuditLog(Base):
    __tablename__ = "audit_log"

    log_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("app_user.user_id"))
    actor_role: Mapped[str] = mapped_column(String(30))           # denormalizowane (rola w chwili zdarzenia)
    action: Mapped[str] = mapped_column(String(40))               # VIEW_DOCUMENTS / DOWNLOAD_PDF / VIEW_NOTE / ACCESS_SHARE / VIEW_RECORD / ANONYMIZE
    patient_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("patient.patient_id"))
    detail: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
