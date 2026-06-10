# Powiadomienia domenowe (UC-P7): zapis do tabeli notification przy zdarzeniach.
# Kanały dodatkowe (e-mail/SMS/push) dojdą jako adaptery; na razie in-app.
from sqlalchemy.orm import Session

from app.models import Notification


def notify(db: Session, user_id: int, title: str, content: str) -> None:
    """Dopisuje powiadomienie w ramach bieżącej transakcji wywołującego."""
    db.add(Notification(
        user_id=user_id,
        notification_title=title[:100],
        notification_content=content,
        is_read=False,
    ))
