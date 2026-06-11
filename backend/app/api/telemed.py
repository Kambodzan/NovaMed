# Telemedycyna (UC-P5/UC-L3, M7): sygnalizacja WebRTC + czat + załączniki.
#
# Architektura: wideo idzie P2P (WebRTC, STUN), backend tylko sygnalizuje
# (offer/answer/ICE) i przekazuje czat przez WebSocket pokoju wizyty.
# Czat jest efemeryczny (na czas rozmowy) — trwałe są dokumenty wystawiane
# w trakcie wizyty i załączniki.
import re
import uuid
from pathlib import Path

from fastapi import (
    APIRouter, Depends, HTTPException, UploadFile, WebSocket,
    WebSocketDisconnect, status,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.family import allowed_patient_ids
from app.core.auth import decode_supabase_token, get_current_user
from app.core.db import get_db
from app.domain.appointments import AppointmentStatus
from app.models import Appointment, AppUser

router = APIRouter(tags=["telemed"])

UPLOADS_DIR = Path(__file__).resolve().parents[2] / "uploads"
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024  # 10 MB

ALLOWED_VISIT_STATUSES = {AppointmentStatus.CONFIRMED.value, AppointmentStatus.IN_PROGRESS.value}


def is_participant(db: Session, a: Appointment, user: AppUser) -> bool:
    """Uczestnik = lekarz wizyty, pacjent albo jego opiekun (konta rodzinne)."""
    return user.user_id == a.doctor_id or a.patient_id in allowed_patient_ids(db, user)


def assert_participant(db: Session, appointment_id: int, user: AppUser) -> Appointment:
    a = db.get(Appointment, appointment_id)
    if a is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wizyta nie istnieje.")
    if not is_participant(db, a, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Nie jesteś uczestnikiem tej wizyty.")
    return a


# ---------- WebSocket: pokój wizyty ----------

class RoomManager:
    """Pokoje per wizyta: user_id → WebSocket. Relay wiadomości do pozostałych."""

    def __init__(self):
        self.rooms: dict[int, dict[int, WebSocket]] = {}

    async def join(self, appointment_id: int, user_id: int, ws: WebSocket) -> None:
        room = self.rooms.setdefault(appointment_id, {})
        room[user_id] = ws

    def leave(self, appointment_id: int, user_id: int) -> None:
        room = self.rooms.get(appointment_id, {})
        room.pop(user_id, None)
        if not room:
            self.rooms.pop(appointment_id, None)

    async def relay(self, appointment_id: int, sender_id: int, message: dict) -> None:
        for uid, ws in list(self.rooms.get(appointment_id, {}).items()):
            if uid != sender_id:
                await ws.send_json(message)


manager = RoomManager()


@router.websocket("/ws/telemed/{appointment_id}")
async def telemed_ws(
    ws: WebSocket,
    appointment_id: int,
    token: str = "",
    db: Session = Depends(get_db),
):
    """Autoryzacja tokenem w query (?token=...) — przeglądarka nie ustawia
    nagłówków przy WebSocket. Wstęp tylko dla pacjenta/lekarza wizyty ONLINE."""
    try:
        claims = decode_supabase_token(token)
    except HTTPException:
        await ws.close(code=4401)
        return
    user = db.scalar(select(AppUser).where(AppUser.supabase_uid == uuid.UUID(claims["sub"])))
    if user is None or not user.active_account:
        await ws.close(code=4401)
        return
    a = db.get(Appointment, appointment_id)
    if a is None or not is_participant(db, a, user):
        await ws.close(code=4403)
        return
    if a.appointment_type != "ONLINE" or a.appointment_status not in ALLOWED_VISIT_STATUSES:
        await ws.close(code=4409)
        return

    role = "doctor" if user.user_id == a.doctor_id else "patient"
    await ws.accept()
    await manager.join(appointment_id, user.user_id, ws)
    await manager.relay(appointment_id, user.user_id, {"type": "peer-joined", "role": role})
    try:
        while True:
            message = await ws.receive_json()
            if not isinstance(message, dict) or "type" not in message:
                continue
            message["sender_role"] = role
            await manager.relay(appointment_id, user.user_id, message)
    except WebSocketDisconnect:
        pass
    finally:
        manager.leave(appointment_id, user.user_id)
        await manager.relay(appointment_id, user.user_id, {"type": "peer-left", "role": role})


# ---------- załączniki (UC-P5: przesyłanie zdjęć/skanów w trakcie wizyty) ----------

class AttachmentOut(BaseModel):
    filename: str
    original_name: str
    url: str
    size: int


@router.post("/telemed/{appointment_id}/attachments", status_code=status.HTTP_201_CREATED, response_model=AttachmentOut)
async def upload_attachment(
    appointment_id: int,
    file: UploadFile,
    user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    assert_participant(db, appointment_id, user)
    content = await file.read()
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Plik większy niż 10 MB.")

    safe_original = re.sub(r"[^\w.\- ]", "_", file.filename or "plik")
    stored_name = f"{uuid.uuid4().hex[:10]}_{safe_original}"
    target_dir = UPLOADS_DIR / str(appointment_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    (target_dir / stored_name).write_bytes(content)

    return AttachmentOut(
        filename=stored_name,
        original_name=safe_original,
        url=f"/telemed/{appointment_id}/attachments/{stored_name}",
        size=len(content),
    )


@router.get("/telemed/{appointment_id}/attachments/{filename}")
def download_attachment(
    appointment_id: int,
    filename: str,
    user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    assert_participant(db, appointment_id, user)
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nieprawidłowa nazwa pliku.")
    path = UPLOADS_DIR / str(appointment_id) / filename
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Załącznik nie istnieje.")
    return FileResponse(path, filename=filename.split("_", 1)[-1])
