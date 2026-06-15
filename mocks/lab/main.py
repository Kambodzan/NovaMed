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

# Panele badań: każdy analit ma jednostkę i zakres referencyjny (low/high; None =
# brak ograniczenia z danej strony). Wartości losowane szerzej niż norma, więc
# część wyników bywa „poza normą" — system placówki je wyróżni.
PANELS = {
    "morfologia": [
        ("WBC", (3.0, 12.0), "tys/µl", 4.0, 10.0),
        ("RBC", (3.6, 5.8), "mln/µl", 4.2, 5.4),
        ("HGB", (11.0, 18.0), "g/dl", 13.0, 17.0),
        ("PLT", (110, 420), "tys/µl", 150, 400),
    ],
    "lipidogram": [
        ("Cholesterol całkowity", (140, 260), "mg/dl", None, 190),
        ("LDL", (70, 200), "mg/dl", None, 115),
        ("HDL", (30, 80), "mg/dl", 40, None),
        ("Trójglicerydy", (70, 250), "mg/dl", None, 150),
    ],
    "glukoza": [("Glukoza na czczo", (70, 140), "mg/dl", 70, 99)],
}


def _rand(lo, hi):
    return round(random.uniform(lo, hi), 1) if isinstance(lo, float) else random.randint(lo, hi)


def generate(test_type: str) -> dict:
    key = next((k for k in PANELS if k in test_type.lower()), None)
    if key is None:
        return {"result": f"Badanie wykonane, wynik w normie (protokół {random.randint(10000, 99999)}).",
                "analytes": []}
    analytes = [
        {"name": name, "value": _rand(lo, hi), "unit": unit, "ref_low": ref_low, "ref_high": ref_high}
        for name, (lo, hi), unit, ref_low, ref_high in PANELS[key]
    ]
    summary = " • ".join(f"{a['name']} {a['value']} {a['unit']}" for a in analytes)
    return {"result": summary, "analytes": analytes}


class OrderIn(BaseModel):
    pesel: str = Field(pattern=r"^\d{11}$")
    referral_code: str = Field(min_length=3, max_length=50)
    test_type: str = Field(min_length=2, max_length=100)


@app.post("/api/v1/orders", status_code=201)
def create_order(body: OrderIn):
    if body.referral_code in _orders:
        raise HTTPException(status_code=409, detail="Lab: zlecenie o tym kodzie skierowania już istnieje.")
    gen = generate(body.test_type)
    _orders[body.referral_code] = {
        "referral_code": body.referral_code,
        "pesel": body.pesel,
        "test_type": body.test_type,
        "status": "READY",  # mock wykonuje badanie natychmiast
        "result": gen["result"],
        "analytes": gen["analytes"],
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
