from fastapi.testclient import TestClient

from app.core.db import get_db
from app.main import app

client = TestClient(app)


def test_health():  # liveness — bez zależności
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["app"] == "NovaMed API"


class _OkDB:
    def execute(self, *a, **k):
        return None


class _BrokenDB:
    def execute(self, *a, **k):
        raise RuntimeError("DB down")


def test_readiness_ok():
    app.dependency_overrides[get_db] = lambda: _OkDB()
    try:
        r = client.get("/health/db")
        assert r.status_code == 200 and r.json()["database"] == "reachable"
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_readiness_db_down_zwraca_503():
    """Gdy baza nieosiągalna, readiness = 503 — LB wypina instancję z puli (HA)."""
    app.dependency_overrides[get_db] = lambda: _BrokenDB()
    try:
        r = client.get("/health/db")
        assert r.status_code == 503 and r.json()["status"] == "unavailable"
    finally:
        app.dependency_overrides.pop(get_db, None)
