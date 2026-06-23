# Port/adapter bramki SMS. Best-effort: awaria bramki nie blokuje operacji domenowej.
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
    """Realna dostawa przez Twilio REST API."""

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


class RedirectSmsClient:
    """DEV: przekierowuje każdy SMS na jeden numer testowy (np. autora). Dzięki temu
    realny SMS dociera niezależnie od numeru wpisanego w formularzu — oryginalny
    adresat trafia do treści, żeby było widać, do kogo „naprawdę" szedł."""

    def __init__(self, inner: SmsClient, redirect_to: str):
        self.inner, self.redirect_to = inner, redirect_to

    def send(self, *, to: str, message: str) -> None:
        self.inner.send(to=self.redirect_to, message=f"[do {to}] {message}")


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
        # DEV-only: przekierowanie wszystkich SMS na numer testowy. Spięte z dev_mode —
        # na produkcji (DEV_MODE=false) jest IGNOROWANE nawet gdy SMS_REDIRECT_TO zostanie
        # ustawione, żeby SMS-y nigdy przypadkiem nie poszły na numer testowy zamiast do
        # pacjenta. Prod = po prostu DEV_MODE=false; nic więcej nie trzeba odkręcać.
        if settings.dev_mode and settings.sms_redirect_to:
            _client = RedirectSmsClient(_client, settings.sms_redirect_to)
    return _client


def set_sms_client(client: SmsClient | None) -> None:
    global _client
    _client = client
