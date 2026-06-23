# Port + adapter HTTP do Systemu P1 (e-recepty, e-skierowania).
# Mock-first, production-swappable: realna integracja = nowy adapter,
# zero zmian w app/api. URL z env (P1_BASE_URL → mock w mocks/p1).
from typing import Protocol

import httpx

from app.core.config import settings
from app.integrations.base import IntegrationError


class P1Client(Protocol):
    def issue_prescription(self, *, pesel: str, doctor_pwz: str, icd10: str | None, drugs: str) -> str: ...

    def issue_referral(self, *, pesel: str, doctor_pwz: str, icd10: str | None, referral_type: str, notes: str | None) -> str: ...

    def revoke_document(self, *, code: str) -> None:
        """Anuluje wystawiony dokument w P1 (storno e-recepty/e-skierowania)."""
        ...

    def verify_referral(self, *, code: str) -> dict | None:
        """Sprawdza e-skierowanie w P1 po kodzie. Zwraca dokument (type/pesel/
        specialization/used/revoked) albo None gdy kod nie istnieje."""
        ...

    def consume_referral(self, *, code: str) -> None:
        """Oznacza skierowanie jako wykorzystane (jednorazowe) przy rezerwacji."""
        ...

    def register_external_referral(self, *, code: str, pesel: str, specialization: str, notes: str | None = None) -> None:
        """Seed/demo: rejestruje w P1 skierowanie wystawione poza NovaMed."""
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

    def issue_prescription(self, *, pesel: str, doctor_pwz: str, icd10: str | None, drugs: str) -> str:
        data = self._post("/api/v1/prescriptions", {
            "pesel": pesel, "doctor_pwz": doctor_pwz, "icd10": icd10, "drugs": drugs,
        })
        return data["prescription_code"]

    def issue_referral(self, *, pesel: str, doctor_pwz: str, icd10: str | None, referral_type: str, notes: str | None) -> str:
        data = self._post("/api/v1/referrals", {
            "pesel": pesel, "doctor_pwz": doctor_pwz, "icd10": icd10,
            "referral_type": referral_type, "notes": notes,
        })
        return data["referral_code"]

    def revoke_document(self, *, code: str) -> None:
        self._post(f"/api/v1/documents/{code}/revoke", {})

    def verify_referral(self, *, code: str) -> dict | None:
        try:
            resp = httpx.get(f"{self.base_url}/api/v1/documents/{code}", timeout=self.timeout)
        except httpx.HTTPError as exc:
            raise IntegrationError("Brak połączenia z systemem P1 — spróbuj ponownie.") from exc
        if resp.status_code == 404:
            return None
        if resp.status_code >= 400:
            raise IntegrationError("P1: nie udało się zweryfikować skierowania.")
        return resp.json()

    def consume_referral(self, *, code: str) -> None:
        self._post(f"/api/v1/documents/{code}/consume", {})

    def register_external_referral(self, *, code: str, pesel: str, specialization: str, notes: str | None = None) -> None:
        self._post("/api/v1/external-referrals", {
            "code": code, "pesel": pesel, "specialization": specialization, "notes": notes,
        })


def get_p1_client() -> P1Client:
    return HttpP1Client()
