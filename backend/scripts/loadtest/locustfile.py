# Test wydajnościowy (NFR M10) — Locust. Scenariusz pacjenta read-heavy, ważony realną
# częstością (dzwonek pollowany najczęściej, przeglądanie slotów intensywne).
# UWAGA: locust działa pod gevent (monkey-patch socketów), który nie znosi psycopg —
# dlatego NIE importujemy tu app/DB. Tokeny i id wczytujemy z fixtures.json
# (wygeneruj wcześniej: python scripts/loadtest/gen_fixtures.py).
#
# Uruchomienie (z katalogu backend/, backend na :8000):
#   .\.venv\Scripts\python.exe scripts/loadtest/gen_fixtures.py
#   .\.venv\Scripts\locust.exe -f scripts/loadtest/locustfile.py --host https://localhost:8000 \
#       --headless -u 50 -r 10 -t 30s --csv scripts/loadtest/out
import json
import random
from pathlib import Path

import urllib3
from locust import HttpUser, between, task

urllib3.disable_warnings()  # cert self-signed w dev

_FX = json.loads(Path(__file__).with_name("fixtures.json").read_text(encoding="utf-8"))
TOKENS, SPEC, CLINIC, DOCTOR = _FX["tokens"], _FX["spec"], _FX["clinic"], _FX["doctor"]


class PatientUser(HttpUser):
    wait_time = between(0.1, 0.5)

    def on_start(self):
        self.client.verify = False
        self.client.headers = {"Authorization": f"Bearer {random.choice(TOKENS)}"}

    @task(6)
    def unread(self):
        self.client.get("/notifications/unread-count", name="GET /notifications/unread-count")

    @task(4)
    def slots_all(self):
        self.client.get("/slots", name="GET /slots (wszystkie)")

    @task(3)
    def slots_spec(self):
        self.client.get(f"/slots?specialization={SPEC}", name="GET /slots?specialization")

    @task(3)
    def slots_clinic(self):
        self.client.get(f"/slots?clinic_id={CLINIC}", name="GET /slots?clinic_id")

    @task(3)
    def my_visits(self):
        self.client.get("/appointments/my", name="GET /appointments/my")

    @task(3)
    def my_docs(self):
        self.client.get("/documents/my", name="GET /documents/my")

    @task(2)
    def doctor_rating(self):
        self.client.get(f"/public/doctors/{DOCTOR}/rating", name="GET /public/doctors/{id}/rating")

    @task(1)
    def me(self):
        self.client.get("/auth/me", name="GET /auth/me")
