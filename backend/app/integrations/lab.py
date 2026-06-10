# Port + adapter HTTP do systemu laboratorium (zlecenia + pobieranie wyników).
from typing import Protocol

import httpx

from app.core.config import settings
from app.integrations.base import IntegrationError


class LabResultDto(dict):
    """Wynik z laboratorium: referral_code, test_type, result, completed_at."""


class LabClient(Protocol):
    def create_order(self, *, pesel: str, referral_code: str, test_type: str) -> None: ...
    def fetch_ready_results(self) -> list[dict]: ...
    def acknowledge(self, referral_code: str) -> None: ...


class HttpLabClient:
    def __init__(self, base_url: str | None = None, timeout: float = 5.0):
        self.base_url = (base_url or settings.lab_base_url).rstrip("/")
        self.timeout = timeout

    def create_order(self, *, pesel: str, referral_code: str, test_type: str) -> None:
        try:
            resp = httpx.post(
                f"{self.base_url}/api/v1/orders",
                json={"pesel": pesel, "referral_code": referral_code, "test_type": test_type},
                timeout=self.timeout,
            )
        except httpx.HTTPError as exc:
            raise IntegrationError("Brak połączenia z laboratorium — zlecenie nie zostało zarejestrowane.") from exc
        if resp.status_code >= 400 and resp.status_code != 409:  # 409 = już zlecone (idempotencja)
            raise IntegrationError("Laboratorium odrzuciło zlecenie badania.")

    def fetch_ready_results(self) -> list[dict]:
        try:
            resp = httpx.get(f"{self.base_url}/api/v1/results", timeout=self.timeout)
        except httpx.HTTPError as exc:
            raise IntegrationError("Brak połączenia z laboratorium — synchronizacja wyników nieudana.") from exc
        if resp.status_code >= 400:
            raise IntegrationError("Laboratorium odrzuciło zapytanie o wyniki.")
        return resp.json()

    def acknowledge(self, referral_code: str) -> None:
        try:
            httpx.post(f"{self.base_url}/api/v1/results/{referral_code}/ack", timeout=self.timeout)
        except httpx.HTTPError:
            pass  # potwierdzenie best-effort; przy braku wynik zostanie zdeduplikowany przy imporcie


def get_lab_client() -> LabClient:
    return HttpLabClient()
