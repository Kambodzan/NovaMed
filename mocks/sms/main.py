# Mock bramki SMS (wzorowany na API operatorów typu SMSAPI/SerwerSMS).
# Uruchomienie (venv backendu):
#   ..\..\backend\.venv\Scripts\python.exe -m uvicorn main:app --port 8106
#
# Wysłane wiadomości można podejrzeć: GET /api/v1/outbox (ostatnie 100).
import itertools
from datetime import datetime

from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="Mock bramki SMS")

_counter = itertools.count(1)
_outbox: list[dict] = []


class SmsIn(BaseModel):
    to: str = Field(min_length=7, max_length=20, description="numer telefonu")
    message: str = Field(min_length=1, max_length=480)


@app.post("/api/v1/sms", status_code=201)
def send_sms(body: SmsIn):
    sms = {
        "sms_id": f"SMS-{next(_counter)}",
        "to": body.to,
        "message": body.message,
        "status": "DELIVERED",
        "sent_at": datetime.now().isoformat(timespec="seconds"),
    }
    _outbox.append(sms)
    del _outbox[:-100]
    return {"sms_id": sms["sms_id"], "status": "DELIVERED"}


@app.get("/api/v1/outbox")
def outbox():
    """Podgląd wysłanych SMS-ów (demo/debug)."""
    return list(reversed(_outbox))


@app.get("/health")
def health():
    return {"status": "ok", "service": "mock-sms"}
