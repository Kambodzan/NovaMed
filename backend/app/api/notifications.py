from uuid import UUID
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.db import get_db
from app.models import AppUser, Notification, PushToken

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationOut(BaseModel):
    notification_id: UUID
    sent_at: datetime
    notification_title: str
    notification_content: str
    is_read: bool


class UnreadOut(BaseModel):
    unread: int


class PushTokenIn(BaseModel):
    token: str
    platform: str = "expo"


@router.get("/my", response_model=list[NotificationOut])
def my_notifications(
    user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(Notification)
        .where(Notification.user_id == user.user_id)
        .order_by(Notification.sent_at.desc())
        .limit(50)
    )
    return [
        NotificationOut(
            notification_id=n.notification_id, sent_at=n.sent_at,
            notification_title=n.notification_title,
            notification_content=n.notification_content, is_read=n.is_read,
        )
        for n in rows
    ]


@router.get("/unread-count", response_model=UnreadOut)
def unread_count(user: AppUser = Depends(get_current_user), db: Session = Depends(get_db)):
    count = db.scalar(
        select(func.count()).select_from(Notification)
        .where(Notification.user_id == user.user_id, Notification.is_read.is_(False))
    )
    return UnreadOut(unread=count or 0)


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_read(
    notification_id: UUID,
    user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    n = db.get(Notification, notification_id)
    if n is None or n.user_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Powiadomienie nie istnieje.")
    n.is_read = True
    db.commit()
    return NotificationOut(
        notification_id=n.notification_id, sent_at=n.sent_at,
        notification_title=n.notification_title,
        notification_content=n.notification_content, is_read=True,
    )


@router.post("/read-all", response_model=UnreadOut)
def mark_all_read(user: AppUser = Depends(get_current_user), db: Session = Depends(get_db)):
    db.execute(
        update(Notification)
        .where(Notification.user_id == user.user_id, Notification.is_read.is_(False))
        .values(is_read=True)
    )
    db.commit()
    return UnreadOut(unread=0)


@router.post("/push-token", status_code=status.HTTP_204_NO_CONTENT)
def register_push_token(
    body: PushTokenIn,
    user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Rejestruje token push urządzenia (apka mobilna po zalogowaniu). Idempotentny:
    ten sam token na innym koncie = przepięcie właściciela (np. nowy login na tym
    samym telefonie), więc powiadomienia nie idą do poprzedniego użytkownika."""
    existing = db.scalar(select(PushToken).where(PushToken.token == body.token))
    if existing is not None:
        existing.user_id = user.user_id
        existing.platform = body.platform
    else:
        db.add(PushToken(user_id=user.user_id, token=body.token, platform=body.platform))
    db.commit()


@router.delete("/push-token", status_code=status.HTTP_204_NO_CONTENT)
def unregister_push_token(
    body: PushTokenIn,
    user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Usuwa token przy wylogowaniu — żeby na współdzielonym urządzeniu kolejny
    użytkownik nie dostawał cudzych powiadomień."""
    db.execute(
        PushToken.__table__.delete().where(
            PushToken.token == body.token, PushToken.user_id == user.user_id
        )
    )
    db.commit()
