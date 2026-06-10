# Mock systemu laboratorium diagnostycznego.
# Uruchomienie (venv backendu):
#   ..\..\backend\.venv\Scripts\python.exe -m uvicorn main:app --port 8104
#
# Flow: placówka rejestruje zlecenie (POST /orders) z kodem e-skierowania;
# mock "wykonuje" badanie od razu i wystawia wynik do pobrania (GET /results).
# Backend pobiera wyniki harmonogramem/synchronizacją (UC-I2).
import random
from datetime import datetime

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="Mock Laboratorium")

_orders: dict[str, dict] = {}  # referral_code → zlecenie z wynikiem

RESULT_TEMPLATES = {
    "morfologia": "WBC {0:.1f} tys/µl • RBC {1:.1f} mln/µl • HGB {2:.1f} g/dl • PLT {3} tys/µl",
    "lipidogram": "Cholesterol całk. {3} mg/dl • LDL {4} mg/dl • HDL {5} mg/dl • TG {6} mg/dl",
    "glukoza": "Glukoza na czczo: {7} mg/dl",
}


def generate_result(test_type: str) -> str:
    vals = (
        random.uniform(4.5, 9.5), random.uniform(4.0, 5.5), random.uniform(12.5, 16.5),
        random.randint(160, 360), random.randint(80, 160), random.randint(40, 70),
        random.randint(70, 190), random.randint(72, 118),
    )
    key = next((k for k in RESULT_TEMPLATES if k in test_type.lower()), None)
    if key:
        return RESULT_TEMPLATES[key].format(*vals)
    return f"Badanie wykonane, wartości w normie (protokół {random.randint(10000, 99999)})."


class OrderIn(BaseModel):
    pesel: str = Field(pattern=r"^\d{11}$")
    referral_code: str = Field(min_length=3, max_length=50)
    test_type: str = Field(min_length=2, max_length=100)


@app.post("/api/v1/orders", status_code=201)
def create_order(body: OrderIn):
    if body.referral_code in _orders:
        raise HTTPException(status_code=409, detail="Lab: zlecenie o tym kodzie skierowania już istnieje.")
    _orders[body.referral_code] = {
        "referral_code": body.referral_code,
        "pesel": body.pesel,
        "test_type": body.test_type,
        "status": "READY",  # mock wykonuje badanie natychmiast
        "result": generate_result(body.test_type),
        "completed_at": datetime.now().isoformat(timespec="seconds"),
    }
    return {"order_id": body.referral_code, "status": "ORDERED"}


@app.get("/api/v1/results")
def list_results():
    """Wyniki gotowe do pobrania przez system placówki."""
    return [o for o in _orders.values() if o["status"] == "READY"]


@app.post("/api/v1/results/{referral_code}/ack")
def acknowledge(referral_code: str):
    """Placówka potwierdza pobranie wyniku — znika z listy do synchronizacji."""
    order = _orders.get(referral_code)
    if order is None:
        raise HTTPException(status_code=404, detail="Lab: brak zlecenia.")
    order["status"] = "DELIVERED"
    return {"status": "ok"}


@app.get("/health")
def health():
    return {"status": "ok", "service": "mock-lab"}
