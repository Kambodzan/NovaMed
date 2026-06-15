# Logowanie dostępu do danych medycznych (RODO, NFR 8.2).
# Best-effort: błąd audytu NIGDY nie może wywrócić właściwego żądania.
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import AppUser, AuditLog


def log_access(db: Session, *, actor: AppUser, action: str,
               patient_id: UUID | None = None, detail: str | None = None) -> None:
    """Zapisuje zdarzenie dostępu personelu do danych pacjenta. Commituje od razu
    (wołane też z GET-ów, które inaczej nie commitują)."""
    try:
        db.add(AuditLog(
            actor_id=actor.user_id,
            actor_role=actor.role.role_name,
            action=action,
            patient_id=patient_id,
            detail=(detail or None) and detail[:255],
        ))
        db.commit()
    except Exception:
        db.rollback()
