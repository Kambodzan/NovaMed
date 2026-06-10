# Port + adapter HTTP do Systemu P1 (e-recepty, e-skierowania).
# Mock-first, production-swappable: realna integracja = nowy adapter,
# zero zmian w app/api. URL z env (P1_BASE_URL → mock w mocks/p1).
from typing import Protocol

import httpx

from app.core.config import settings
from app.integrations.base import IntegrationError


class P1Client(Protocol):
    def issue_prescription(self, *, pesel: str, doctor_pwz: str, icd10: str, drugs: str) -> str:
        """Zwraca kod e-recepty."""
        ...

    def issue_referral(self, *, pesel: str, doctor_pwz: str, icd10: str, referral_type: str, notes: str | None) -> str:
        """Zwraca kod e-skierowania."""
        ...


class HttpP1Client:
    def __init__(self, base_url: str | None = None, timeout: float = 5.0):
        self.base_url = (base_url or settings.p1_base_url).rstrip("/")
        self.timeout = timeout

    def _post(self, path: str, payload: dict) -> dict:
        try:
            resp = httpx.post(f"{self.base_url}{path}", json=payload, timeout=self.timeout)
        except httpx.HTTPError as exc:
            raise IntegrationError("Brak połączenia z systemem P1. Dokument zapisano lokalnie — wyślij ponownie później.") from exc
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except ValueError:
                detail = resp.text
            raise IntegrationError(f"P1 odrzuciło dokument: {detail}")
        return resp.json()

    def issue_prescription(self, *, pesel: str, doctor_pwz: str, icd10: str, drugs: str) -> str:
        data = self._post("/api/v1/prescriptions", {
            "pesel": pesel, "doctor_pwz": doctor_pwz, "icd10": icd10, "drugs": drugs,
        })
        return data["prescription_code"]

    def issue_referral(self, *, pesel: str, doctor_pwz: str, icd10: str, referral_type: str, notes: str | None) -> str:
        data = self._post("/api/v1/referrals", {
            "pesel": pesel, "doctor_pwz": doctor_pwz, "icd10": icd10,
            "referral_type": referral_type, "notes": notes,
        })
        return data["referral_code"]


def get_p1_client() -> P1Client:
    """Dependency FastAPI — w testach podmieniane na fake."""
    return HttpP1Client()
