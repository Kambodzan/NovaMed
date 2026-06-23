# Port + adapter HTTP do systemu eWUŚ (weryfikacja ubezpieczenia po PESEL).
from typing import Protocol

import httpx

from app.core.config import settings
from app.integrations.base import IntegrationError


class EwusClient(Protocol):
    def verify(self, *, pesel: str) -> bool: ...


class HttpEwusClient:
    def __init__(self, base_url: str | None = None, timeout: float = 5.0):
        self.base_url = (base_url or settings.ewus_base_url).rstrip("/")
        self.timeout = timeout

    def verify(self, *, pesel: str) -> bool:
        try:
            resp = httpx.post(f"{self.base_url}/api/v1/verify", json={"pesel": pesel}, timeout=self.timeout)
        except httpx.HTTPError as exc:
            raise IntegrationError("Brak połączenia z eWUŚ — status ubezpieczenia niezweryfikowany.") from exc
        if resp.status_code >= 400:
            raise IntegrationError("eWUŚ odrzucił zapytanie o status ubezpieczenia.")
        return bool(resp.json()["insured"])


def get_ewus_client() -> EwusClient:
    return HttpEwusClient()
