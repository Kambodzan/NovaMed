import itertools
import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.db import Base, get_db
from app.integrations.base import IntegrationError
from app.integrations.ewus import get_ewus_client
from app.integrations.lab import get_lab_client
from app.integrations.p1 import get_p1_client
from app.integrations.payments import get_payments_client
from app.integrations.email import set_email_client
from app.integrations.push import set_push_client
from app.integrations.sms import set_sms_client
from app.main import app
from app.models import AppUser, Clinic, Doctor, DoctorSpecialization, Patient, Role, StaffClinic


class FakeEwus:
    def __init__(self):
        self.insured = True
        self.fail = False
        self.calls: list[str] = []

    def verify(self, *, pesel: str) -> bool:
        if self.fail:
            raise IntegrationError("eWUŚ niedostępny (test).")
        self.calls.append(pesel)
        return self.insured


class FakeLab:
    def __init__(self):
        self.orders: list[dict] = []
        self.results: list[dict] = []
        self.acked: list[str] = []
        self.fail = False

    def create_order(self, *, pesel: str, referral_code: str, test_type: str) -> None:
        if self.fail:
            raise IntegrationError("Laboratorium niedostępne (test).")
        self.orders.append({"pesel": pesel, "referral_code": referral_code, "test_type": test_type})

    def fetch_ready_results(self) -> list[dict]:
        if self.fail:
            raise IntegrationError("Laboratorium niedostępne (test).")
        return list(self.results)

    def acknowledge(self, referral_code: str) -> None:
        self.acked.append(referral_code)


class FakeSms:
    def __init__(self):
        self.sent: list[dict] = []

    def send(self, *, to: str, message: str) -> None:
        self.sent.append({"to": to, "message": message})


class FakeEmail:
    def __init__(self):
        self.sent: list[dict] = []

    def send(self, *, to: str, subject: str, body: str) -> None:
        self.sent.append({"to": to, "subject": subject, "body": body})


class FakePush:
    def __init__(self):
        self.sent: list[dict] = []

    def send(self, *, tokens, title, body, data=None) -> None:
        self.sent.append({"tokens": list(tokens), "title": title, "body": body, "data": data})


class FakePayments:
    def __init__(self):
        self._counter = itertools.count(1)
        self.payments: dict[str, str] = {}

    def create_payment(self, *, amount: float, reference: str) -> str:
        ref = f"PAY-T{next(self._counter)}"
        self.payments[ref] = "PENDING"
        return ref

    def confirm(self, *, provider_ref: str, outcome: str) -> str:
        self.payments[provider_ref] = "PAID" if outcome == "success" else "FAILED"
        return self.payments[provider_ref]

    def get_status(self, *, provider_ref: str) -> str:
        return self.payments[provider_ref]

    def issue_invoice(self, *, amount: float, reference: str, buyer: str | None = None) -> str:
        return f"FV/2026/{next(self._counter):05d}"


class FakeP1:
    """Fake P1 w pamięci — e-recepty/e-skierowania + weryfikacja kodu skierowania."""
    def __init__(self):
        self._docs: dict[str, dict] = {}
        self._counter = itertools.count(1)

    def _code(self) -> str:
        return f"{next(self._counter):04d}"

    def issue_prescription(self, *, pesel, doctor_pwz, icd10, drugs) -> str:
        code = self._code()
        self._docs[code] = {"type": "prescription", "pesel": pesel}
        return code

    def issue_referral(self, *, pesel, doctor_pwz, icd10, referral_type, notes) -> str:
        code = self._code()
        self._docs[code] = {"type": "referral", "pesel": pesel, "referral_type": referral_type}
        return code

    def revoke_document(self, *, code) -> None:
        if code in self._docs:
            self._docs[code]["revoked"] = True

    def register_external_referral(self, *, code, pesel, specialization, notes=None) -> None:
        self._docs[code] = {"type": "referral", "source": "external", "pesel": pesel,
                            "specialization": specialization, "notes": notes, "used": False}

    def verify_referral(self, *, code) -> dict | None:
        return self._docs.get(code)

    def consume_referral(self, *, code) -> None:
        from app.integrations.base import IntegrationError
        doc = self._docs.get(code)
        if doc is None:
            raise IntegrationError("P1: brak dokumentu.")
        if doc.get("used"):
            raise IntegrationError("P1: skierowanie już wykorzystane.")
        doc["used"] = True


TEST_SECRET = "test-jwt-secret-0123456789abcdefghijklmn"


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session = TestingSession()
    for name in ["pacjent", "lekarz", "pielegniarka", "rejestracja", "kierownik", "administrator"]:
        session.add(Role(role_name=name))
    session.commit()
    yield session
    session.close()
    engine.dispose()


@pytest.fixture()
def integration_fakes():
    """Fake-klienty integracji — testy są hermetyczne (zero HTTP)."""
    return SimpleNamespace(ewus=FakeEwus(), lab=FakeLab(), payments=FakePayments(), sms=FakeSms(), p1=FakeP1(), email=FakeEmail(), push=FakePush())


@pytest.fixture()
def client(db_session, monkeypatch, integration_fakes):
    monkeypatch.setattr(settings, "supabase_jwt_secret", TEST_SECRET)
    monkeypatch.setattr(settings, "reminders_enabled", False)  # pętla nie rusza w testach

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_ewus_client] = lambda: integration_fakes.ewus
    app.dependency_overrides[get_lab_client] = lambda: integration_fakes.lab
    app.dependency_overrides[get_payments_client] = lambda: integration_fakes.payments
    app.dependency_overrides[get_p1_client] = lambda: integration_fakes.p1
    set_sms_client(integration_fakes.sms)  # SMS nie jest dependency FastAPI — singleton modułu
    set_email_client(integration_fakes.email)
    set_push_client(integration_fakes.push)
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
    set_sms_client(None)
    set_email_client(None)
    set_push_client(None)


def make_token(sub: str | None = None, email: str = "jan.testowy@example.com", secret: str = TEST_SECRET) -> str:
    payload = {
        "sub": sub or str(uuid.uuid4()),
        "email": email,
        "aud": "authenticated",
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def verify_phone(client, phone: str, purpose: str = "REGISTRATION") -> None:
    """Przeprowadza weryfikację OTP (wyślij→potwierdź) tak, jak zrobiłby to front:
    w DEV kod wraca w odpowiedzi `dev_code`, więc test nie potrzebuje bramki SMS."""
    code = client.post("/public/otp/send", json={"phone_number": phone, "purpose": purpose}).json()["dev_code"]
    r = client.post("/public/otp/verify", json={"phone_number": phone, "code": code, "purpose": purpose})
    assert r.status_code == 200, r.text


@pytest.fixture()
def factory(db_session):
    """Fabryka encji domenowych do testów — tworzy użytkowników z tokenami."""

    class Factory:
        def user(self, role_name: str) -> tuple[AppUser, str]:
            role = db_session.scalar(select(Role).where(Role.role_name == role_name))
            uid = uuid.uuid4()
            user = AppUser(
                supabase_uid=uid,
                role_id=role.role_id,
                username=f"{role_name}-{uid.hex[:6]}",
                email=f"{uid.hex[:10]}@test.pl",
                active_account=True,
            )
            db_session.add(user)
            db_session.commit()
            return user, make_token(sub=str(uid), email=user.email)

        def doctor(self, specialization: str | list[str] = "Kardiolog") -> tuple[AppUser, str]:
            user, token = self.user("lekarz")
            db_session.add(Doctor(doctor_id=user.user_id, license_number="1234567"))
            db_session.flush()
            specs = [specialization] if isinstance(specialization, str) else specialization
            for name in specs:
                db_session.add(DoctorSpecialization(doctor_id=user.user_id, name=name))
            db_session.commit()
            return user, token

        def patient(self) -> tuple[AppUser, str]:
            user, token = self.user("pacjent")
            user.phone_number = "601234567"  # kanał SMS w powiadomieniach
            db_session.add(Patient(
                patient_id=user.user_id, first_name="Jan", last_name="Testowy",
                pesel="90010112345", birth_date=date(1990, 1, 1), insurance_status=True,
            ))
            db_session.commit()
            return user, token

        def clinic(self, name: str = "Przychodnia Testowa") -> Clinic:
            clinic = Clinic(clinic_name=name, address="ul. Testowa 1, Warszawa")
            db_session.add(clinic)
            db_session.commit()
            return clinic

        def employ(self, clinic: Clinic, user_id: int) -> None:
            db_session.add(StaffClinic(clinic_id=clinic.clinic_id, user_id=user_id, start_date=date.today()))
            db_session.commit()

    return Factory()
