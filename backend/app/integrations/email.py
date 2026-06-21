# Port + adapter kanału e-mail. Best-effort (jak SMS): awaria nie blokuje operacji
# domenowej. Mock-first: w dev loguje + trzyma outbox; realnie SMTP (sekrety w .env).
import logging
import smtplib
from email.mime.text import MIMEText
from typing import Protocol

from app.core.config import settings

logger = logging.getLogger("novamed.email")


class EmailClient(Protocol):
    def send(self, *, to: str, subject: str, body: str) -> None: ...


class MockEmailClient:
    """DEV: nie wysyła realnie — loguje i zapisuje do outboxa (podgląd, że „poszło")."""

    def __init__(self) -> None:
        self.outbox: list[dict] = []

    def send(self, *, to: str, subject: str, body: str) -> None:
        self.outbox.append({"to": to, "subject": subject, "body": body})
        logger.info("E-mail (mock) → %s | %s", to, subject)


class SmtpEmailClient:
    """Realna dostawa przez SMTP (np. Gmail/SendGrid/own). Best-effort — awaria nie psuje."""

    def __init__(self, host: str, port: int, user: str, password: str, sender: str):
        self.host, self.port, self.user, self.password, self.sender = host, port, user, password, sender

    def send(self, *, to: str, subject: str, body: str) -> None:
        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"], msg["From"], msg["To"] = subject, self.sender or self.user, to
        try:
            with smtplib.SMTP(self.host, self.port, timeout=8) as s:
                s.starttls()
                if self.user:
                    s.login(self.user, self.password)
                s.send_message(msg)
            logger.info("E-mail wysłany → %s | %s", to, subject)
        except Exception as exc:  # noqa: BLE001 — best-effort
            logger.warning("E-mail — błąd wysyłki → %s: %s", to, exc)


class RedirectEmailClient:
    """DEV: przekierowuje każdy e-mail na jeden adres testowy (jak redirect SMS)."""

    def __init__(self, inner: EmailClient, redirect_to: str):
        self.inner, self.redirect_to = inner, redirect_to

    def send(self, *, to: str, subject: str, body: str) -> None:
        self.inner.send(to=self.redirect_to, subject=subject, body=f"[do {to}]\n\n{body}")


_client: EmailClient | None = None


def get_email_client() -> EmailClient:
    global _client
    if _client is None:
        if (settings.email_provider == "smtp"
                and settings.smtp_host and settings.smtp_from):
            _client = SmtpEmailClient(settings.smtp_host, settings.smtp_port,
                                      settings.smtp_user, settings.smtp_password, settings.smtp_from)
        else:
            _client = MockEmailClient()
        # DEV-only redirect: wszystkie maile na jeden adres testowy (ignorowane na produkcji)
        if settings.dev_mode and settings.email_redirect_to:
            _client = RedirectEmailClient(_client, settings.email_redirect_to)
    return _client


def set_email_client(client: EmailClient | None) -> None:
    global _client
    _client = client
