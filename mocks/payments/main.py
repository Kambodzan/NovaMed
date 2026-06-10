# Mock operatora płatności (karta/BLIK) — wzorowany na przepływie bramek
# typu P24/PayU: utworzenie płatności → autoryzacja klienta → status.
# Uruchomienie (venv backendu):
#   ..\..\backend\.venv\Scripts\python.exe -m uvicorn main:app --port 8105
#
# W realnej integracji potwierdzenie przychodzi webhookiem po 3DS;
# w mocku potwierdza je wprost backend (symulacja sukcesu/odmowy).
import itertools

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="Mock operatora płatności")

_counter = itertools.count(50000)
_payments: dict[str, dict] = {}


class PaymentIn(BaseModel):
    amount: float = Field(gt=0)
    currency: str = "PLN"
    reference: str = Field(min_length=1, max_length=100, description="np. appointment-123")


class ConfirmIn(BaseModel):
    outcome: str = Field(pattern="^(success|failure)$")


@app.post("/api/v1/payments", status_code=201)
def create_payment(body: PaymentIn):
    pid = f"PAY-{next(_counter)}"
    _payments[pid] = {"payment_id": pid, "status": "PENDING", **body.model_dump()}
    return {
        "payment_id": pid,
        "status": "PENDING",
        "redirect_url": f"https://mock-payments.novamed.local/checkout/{pid}",
    }


@app.post("/api/v1/payments/{payment_id}/confirm")
def confirm_payment(payment_id: str, body: ConfirmIn):
    p = _payments.get(payment_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Płatność nie istnieje.")
    if p["status"] != "PENDING":
        raise HTTPException(status_code=409, detail=f"Płatność ma już status {p['status']}.")
    p["status"] = "PAID" if body.outcome == "success" else "FAILED"
    return {"payment_id": payment_id, "status": p["status"]}


@app.get("/api/v1/payments/{payment_id}")
def get_payment(payment_id: str):
    p = _payments.get(payment_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Płatność nie istnieje.")
    return p


@app.get("/health")
def health():
    return {"status": "ok", "service": "mock-payments"}
