# Mock Systemu P1 (e-recepty, e-skierowania) — osobny serwis FastAPI.
# Kontrakt wzorowany na realnych przepływach P1 (uproszczony): przyjęcie dokumentu,
# walidacja, zwrot kodu. Podmiana na realną integrację = zmiana P1_BASE_URL w backendzie.
#
# Uruchomienie (venv backendu):
#   ..\..\backend\.venv\Scripts\python.exe -m uvicorn main:app --port 8101
#
# Symulacja błędów: pesel zaczynający się od "00" → 422 (testowanie ścieżki Error).
import random
import re

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="Mock P1 — e-recepty i e-skierowania")

_issued: dict[str, dict] = {}  # kod → dokument (pamięć procesu wystarcza dla mocka)


class PrescriptionIn(BaseModel):
    pesel: str = Field(pattern=r"^\d{11}$")
    doctor_pwz: str = Field(min_length=7, max_length=7)
    icd10: str = Field(min_length=3, max_length=10)
    drugs: str = Field(min_length=3)


class ReferralIn(BaseModel):
    pesel: str = Field(pattern=r"^\d{11}$")
    doctor_pwz: str = Field(min_length=7, max_length=7)
    icd10: str = Field(min_length=3, max_length=10)
    referral_type: str = Field(min_length=3, max_length=100)
    notes: str | None = None


def _validate(pesel: str, icd10: str) -> None:
    if pesel.startswith("00"):
        raise HTTPException(status_code=422, detail="P1: pacjent o podanym PESEL nie figuruje w rejestrze.")
    if not re.fullmatch(r"[A-Z]\d{2}(\.\d{1,2})?", icd10):
        raise HTTPException(status_code=422, detail="P1: nieprawidłowy kod rozpoznania ICD-10.")


@app.post("/api/v1/prescriptions", status_code=201)
def issue_prescription(body: PrescriptionIn):
    _validate(body.pesel, body.icd10)
    code = f"{random.randint(0, 9999):04d}"
    _issued[code] = {"type": "prescription", **body.model_dump()}
    return {"prescription_code": code, "status": "CONFIRMED"}


@app.post("/api/v1/referrals", status_code=201)
def issue_referral(body: ReferralIn):
    _validate(body.pesel, body.icd10)
    code = f"{random.randint(0, 9999):04d}"
    _issued[code] = {"type": "referral", **body.model_dump()}
    return {"referral_code": code, "status": "CONFIRMED"}


@app.get("/api/v1/documents/{code}")
def get_document(code: str):
    doc = _issued.get(code)
    if doc is None:
        raise HTTPException(status_code=404, detail="P1: dokument o podanym kodzie nie istnieje.")
    return doc


@app.post("/api/v1/documents/{code}/revoke")
def revoke_document(code: str):
    """Anulowanie wystawionego dokumentu (storno e-recepty/e-skierowania)."""
    doc = _issued.get(code)
    if doc is None:
        raise HTTPException(status_code=404, detail="P1: dokument o podanym kodzie nie istnieje.")
    if doc.get("revoked"):
        raise HTTPException(status_code=409, detail="P1: dokument został już anulowany.")
    doc["revoked"] = True
    return {"code": code, "status": "REVOKED"}


@app.get("/health")
def health():
    return {"status": "ok", "service": "mock-p1"}
