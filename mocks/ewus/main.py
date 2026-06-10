# Mock systemu eWUŚ (Elektroniczna Weryfikacja Uprawnień Świadczeniobiorców).
# Uruchomienie (venv backendu):
#   ..\..\backend\.venv\Scripts\python.exe -m uvicorn main:app --port 8103
#
# Reguła odpowiedzi (deterministyczna dla dema):
#   PESEL kończący się na "9" lub zaczynający od "00" → nieubezpieczony,
#   pozostałe → ubezpieczony.
from datetime import datetime

from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="Mock eWUŚ")


class VerifyIn(BaseModel):
    pesel: str = Field(pattern=r"^\d{11}$")


@app.post("/api/v1/verify")
def verify(body: VerifyIn):
    insured = not (body.pesel.endswith("9") or body.pesel.startswith("00"))
    return {
        "pesel": body.pesel,
        "insured": insured,
        "status": "ubezpieczony" if insured else "nieubezpieczony",
        "verified_at": datetime.now().isoformat(timespec="seconds"),
    }


@app.get("/health")
def health():
    return {"status": "ok", "service": "mock-ewus"}
