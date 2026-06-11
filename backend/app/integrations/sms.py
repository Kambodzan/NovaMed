# Port + adapter HTTP do bramki SMS. Kanał jest best-effort:
# awaria bramki nigdy nie blokuje operacji domenowej (SMS to dodatek
# do powiadomienia in-app, nie jego warunek).
from typing import Protocol

import httpx

from app.core.config import settings


class SmsClient(Protocol):
    def send(self, *, to: str, message: str) -> None: ...


class HttpSmsClient:
    def __init__(self, base_url: str | None = None, timeout: float = 3.0):
        self.base_url = (base_url or settings.sms_base_url).rstrip("/")
        self.timeout = timeout

    def send(self, *, to: str, message: str) -> None:
        # bez wyjątków na zewnątrz — best-effort
        try:
            httpx.post(
                f"{self.base_url}/api/v1/sms",
                json={"to": to, "message": message[:480]},
                timeout=self.timeout,
            )
        except httpx.HTTPError:
            pass


class NullSmsClient:
    def send(self, *, to: str, message: str) -> None:  # noqa: ARG002
        pass


# moduł trzyma jeden klient; testy podmieniają przez set_sms_client()
_client: SmsClient | None = None


def get_sms_client() -> SmsClient:
    global _client
    if _client is None:
        _client = HttpSmsClient() if settings.sms_enabled else NullSmsClient()
    return _client


def set_sms_client(client: SmsClient | None) -> None:
    global _client
    _client = client
