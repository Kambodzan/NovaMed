# Port + adapter HTTP do ZUS e-ZLA (elektroniczne zwolnienia lekarskie).
from datetime import date
from typing import Protocol

import httpx

from app.core.config import settings
from app.integrations.base import IntegrationError


class ZusClient(Protocol):
    def issue_sick_leave(self, *, pesel: str, doctor_pwz: str, date_from: date, date_to: date, indication: str) -> str:
        """Zwraca kod e-ZLA."""
        ...

    def revoke_sick_leave(self, *, code: str) -> None:
        """Anuluje e-ZLA (np. błędnie wystawione zwolnienie)."""
        ...


class HttpZusClient:
    def __init__(self, base_url: str | None = None, timeout: float = 5.0):
        self.base_url = (base_url or settings.zus_base_url).rstrip("/")
        self.timeout = timeout

    def issue_sick_leave(self, *, pesel: str, doctor_pwz: str, date_from: date, date_to: date, indication: str) -> str:
        payload = {
            "pesel": pesel, "doctor_pwz": doctor_pwz,
            "date_from": date_from.isoformat(), "date_to": date_to.isoformat(),
            "indication": indication,
        }
        try:
            resp = httpx.post(f"{self.base_url}/api/v1/sick-leaves", json=payload, timeout=self.timeout)
        except httpx.HTTPError as exc:
            raise IntegrationError("Brak połączenia z ZUS e-ZLA. Zwolnienie zapisano lokalnie — wyślij ponownie później.") from exc
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except ValueError:
                detail = resp.text
            raise IntegrationError(f"ZUS odrzucił zwolnienie: {detail}")
        return resp.json()["sick_leave_code"]

    def revoke_sick_leave(self, *, code: str) -> None:
        try:
            resp = httpx.post(f"{self.base_url}/api/v1/sick-leaves/{code}/revoke", timeout=self.timeout)
        except httpx.HTTPError as exc:
            raise IntegrationError("Brak połączenia z ZUS e-ZLA — spróbuj ponownie później.") from exc
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except ValueError:
                detail = resp.text
            raise IntegrationError(f"ZUS nie anulował zwolnienia: {detail}")


def get_zus_client() -> ZusClient:
    """Dependency FastAPI — w testach podmieniane na fake."""
    return HttpZusClient()
