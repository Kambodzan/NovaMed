# Powiadomienia domenowe (UC-P7): zapis do tabeli notification przy zdarzeniach
# + kanał SMS (best-effort, na numer z konta; mock bramki w mocks/sms).
from sqlalchemy.orm import Session

from app.integrations.sms import get_sms_client
from app.models import AppUser, Notification


def notify(db: Session, user_id: int, title: str, content: str) -> None:
    """Dopisuje powiadomienie w ramach bieżącej transakcji wywołującego.
    SMS wysyłany od razu (poza transakcją DB) — jego awaria niczego nie psuje."""
    db.add(Notification(
        user_id=user_id,
        notification_title=title[:100],
        notification_content=content,
        is_read=False,
    ))
    user = db.get(AppUser, user_id)
    if user is not None and user.phone_number:
        get_sms_client().send(to=user.phone_number, message=f"NovaMed: {title}. {content}")
