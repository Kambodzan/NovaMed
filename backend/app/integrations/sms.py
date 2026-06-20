# Port + adapter HTTP do bramki SMS. Kanał jest best-effort:
# awaria bramki nigdy nie blokuje operacji domenowej (SMS to dodatek
# do powiadomienia in-app, nie jego warunek).
import logging
from typing import Protocol

import httpx

from app.core.config import settings

logger = logging.getLogger("novamed.sms")


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


def _to_e164(number: str) -> str:
    """Numer w formacie E.164 (Twilio tego wymaga). Bez '+' dokleja kierunkowy."""
    n = "".join(ch for ch in number if ch.isdigit() or ch == "+")
    if n.startswith("+"):
        return n
    return f"+{settings.sms_default_country}{n.lstrip('0')}"


class TwilioSmsClient:
    """Realna dostawa przez Twilio REST API (best-effort — awaria nie blokuje)."""

    def __init__(self, sid: str, token: str, sender: str, timeout: float = 6.0):
        self.sid, self.token, self.sender, self.timeout = sid, token, sender, timeout

    def send(self, *, to: str, message: str) -> None:
        dst = _to_e164(to)
        try:
            resp = httpx.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{self.sid}/Messages.json",
                data={"To": dst, "From": self.sender, "Body": message[:480]},
                auth=(self.sid, self.token),
                timeout=self.timeout,
            )
            # best-effort, ale logujemy ODRZUCENIE Twilio (np. 21608 numer niezweryfikowany
            # na trialu, 21408 brak zgody geograficznej na region) — inaczej „nie przychodzi"
            # jest niediagnozowalne. Sekretów nie logujemy.
            if resp.status_code >= 400:
                try:
                    j = resp.json()
                    why = f"{j.get('code')}: {j.get('message')}"
                except ValueError:
                    why = resp.text[:200]
                logger.warning("Twilio odrzucił SMS na %s (HTTP %s) — %s", dst, resp.status_code, why)
            else:
                logger.info("Twilio: SMS przyjęty do wysyłki na %s", dst)
        except httpx.HTTPError as exc:
            logger.warning("Twilio: błąd połączenia przy wysyłce na %s — %s", dst, exc)


class NullSmsClient:
    def send(self, *, to: str, message: str) -> None:  # noqa: ARG002
        pass


# moduł trzyma jeden klient; testy podmieniają przez set_sms_client()
_client: SmsClient | None = None


def get_sms_client() -> SmsClient:
    global _client
    if _client is None:
        if not settings.sms_enabled:
            _client = NullSmsClient()
        elif (settings.sms_provider == "twilio"
              and settings.twilio_account_sid and settings.twilio_auth_token and settings.twilio_from):
            _client = TwilioSmsClient(settings.twilio_account_sid, settings.twilio_auth_token, settings.twilio_from)
        else:
            _client = HttpSmsClient()  # mock-serwis :8106
    return _client


def set_sms_client(client: SmsClient | None) -> None:
    global _client
    _client = client
