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
from app.integrations.payments import get_payments_client
from app.main import app
from app.models import AppUser, Clinic, Doctor, Patient, Role, StaffClinic


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
    """Fake-klienty integracji M6 — testy są hermetyczne (zero HTTP)."""
    return SimpleNamespace(ewus=FakeEwus(), lab=FakeLab(), payments=FakePayments())


@pytest.fixture()
def client(db_session, monkeypatch, integration_fakes):
    monkeypatch.setattr(settings, "supabase_jwt_secret", TEST_SECRET)

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_ewus_client] = lambda: integration_fakes.ewus
    app.dependency_overrides[get_lab_client] = lambda: integration_fakes.lab
    app.dependency_overrides[get_payments_client] = lambda: integration_fakes.payments
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


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

        def doctor(self, specialization: str = "Kardiolog") -> tuple[AppUser, str]:
            user, token = self.user("lekarz")
            db_session.add(Doctor(doctor_id=user.user_id, license_number="1234567", specialization=specialization))
            db_session.commit()
            return user, token

        def patient(self) -> tuple[AppUser, str]:
            user, token = self.user("pacjent")
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
