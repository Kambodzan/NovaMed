# Mock ZUS e-ZLA (elektroniczne zwolnienia lekarskie) — osobny serwis FastAPI.
# Uruchomienie (venv backendu):
#   ..\..\backend\.venv\Scripts\python.exe -m uvicorn main:app --port 8102
#
# Symulacja błędów: doctor_pwz "0000000" → 403 (brak autoryzacji w ZUS).
import itertools
from datetime import date

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, model_validator

app = FastAPI(title="Mock ZUS e-ZLA")

_counter = itertools.count(1000)
_issued: dict[str, dict] = {}


class SickLeaveIn(BaseModel):
    pesel: str = Field(pattern=r"^\d{11}$")
    doctor_pwz: str = Field(min_length=7, max_length=7)
    date_from: date
    date_to: date
    indication: str = Field(default="chory powinien leżeć", max_length=255)

    @model_validator(mode="after")
    def validate_range(self):
        if self.date_to < self.date_from:
            raise ValueError("Data końca zwolnienia przed datą początku.")
        return self


@app.post("/api/v1/sick-leaves", status_code=201)
def issue_sick_leave(body: SickLeaveIn):
    if body.doctor_pwz == "0000000":
        raise HTTPException(status_code=403, detail="ZUS: lekarz nie ma autoryzacji do wystawiania e-ZLA.")
    code = f"ZLA-{body.date_from.year}-{next(_counter)}"
    _issued[code] = body.model_dump(mode="json")
    return {"sick_leave_code": code, "status": "SENT"}


@app.get("/api/v1/sick-leaves/{code}")
def get_sick_leave(code: str):
    doc = _issued.get(code)
    if doc is None:
        raise HTTPException(status_code=404, detail="ZUS: zwolnienie o podanym kodzie nie istnieje.")
    return {**doc, "review_status": "PRZYJETE"}


@app.get("/health")
def health():
    return {"status": "ok", "service": "mock-zus-ezla"}
