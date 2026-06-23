# Pre-krok testu wydajnościowego: mintuje tokeny HS256 dla zaseedowanych pacjentów
# i zbiera id (spec/clinic/doctor) do fixtures.json. Uruchamiany ZWYKŁYM pythonem
# (locust/gevent nie znosi psycopg w swoim procesie — stąd rozdział).
import datetime
import json
from pathlib import Path

import jwt
from sqlalchemy import select

from app.core.config import settings
from app.core.db import SessionLocal
from app.models import AppUser, Clinic, Doctor, DoctorSpecialization, Patient


def _mint(sub: str) -> str:
    return jwt.encode(
        {"sub": sub, "email": "load@test.dev", "aud": "authenticated",
         "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=3)},
        settings.supabase_jwt_secret, algorithm="HS256")


db = SessionLocal()
subs = [str(u.supabase_uid) for u in db.scalars(
    select(AppUser).join(Patient, Patient.patient_id == AppUser.user_id)
    .where(AppUser.active_account.is_(True)).limit(5)).all()]
data = {
    "tokens": [_mint(s) for s in subs],
    "spec": db.scalar(select(DoctorSpecialization.name)),
    "clinic": str(db.scalar(select(Clinic.clinic_id))),
    "doctor": str(db.scalar(select(Doctor.doctor_id))),
}
db.close()
Path(__file__).with_name("fixtures.json").write_text(json.dumps(data), encoding="utf-8")
print(f"fixtures.json: {len(data['tokens'])} tokenów, spec={data['spec']}")
