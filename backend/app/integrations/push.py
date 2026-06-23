# Port + adapter do powiadomień push (Expo Push API). Kanał best-effort:
# awaria nigdy nie blokuje operacji domenowej (push to dodatek do powiadomienia
# in-app, nie jego warunek) — tak samo jak SMS/e-mail.
#
# Expo Push: tokeny urządzeń (ExponentPushToken[...]) autoryzują dostawę,
# żaden sekret serwera nie jest wymagany dla podstawowej wysyłki. Endpoint:
# https://exp.host/--/api/v2/push/send  (przyjmuje pojedynczy obiekt lub listę).
import logging
from typing import Protocol

import httpx

from app.core.config import settings

logger = logging.getLogger("novamed.push")

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


class PushClient(Protocol):
    def send(self, *, tokens: list[str], title: str, body: str,
             data: dict | None = None) -> None: ...


class ExpoPushClient:
    """Realna dostawa przez Expo Push API (best-effort — awaria nie blokuje)."""

    def __init__(self, timeout: float = 6.0):
        self.timeout = timeout

    def send(self, *, tokens: list[str], title: str, body: str,
             data: dict | None = None) -> None:
        valid = [t for t in tokens if t and t.startswith("ExponentPushToken")]
        if not valid:
            return
        messages = [
            {"to": t, "title": title, "body": body, "sound": "default",
             **({"data": data} if data else {})}
            for t in valid
        ]
        try:
            resp = httpx.post(
                EXPO_PUSH_URL,
                json=messages,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
                timeout=self.timeout,
            )
            if resp.status_code >= 400:
                logger.warning("Expo push odrzucił (HTTP %s) — %s", resp.status_code, resp.text[:200])
            else:
                logger.info("Expo push przyjęty do wysyłki (%d urządzeń)", len(valid))
        except httpx.HTTPError as exc:
            logger.warning("Expo push: błąd połączenia — %s", exc)


class NullPushClient:
    def send(self, *, tokens: list[str], title: str, body: str,  # noqa: ARG002
             data: dict | None = None) -> None:
        pass


# moduł trzyma jeden klient; testy podmieniają przez set_push_client()
_client: PushClient | None = None


def get_push_client() -> PushClient:
    global _client
    if _client is None:
        if settings.push_enabled and settings.push_provider == "expo":
            _client = ExpoPushClient()
        else:
            _client = NullPushClient()
    return _client


def set_push_client(client: PushClient | None) -> None:
    global _client
    _client = client
