# Potwierdzanie/odwołanie wizyty z linka SMS: token na wizycie
# + budowa linku do publicznej strony frontendu.
import secrets

from app.core.config import settings
from app.models import Appointment


def ensure_confirm_token(a: Appointment) -> str:
    """Zwraca (tworząc w razie potrzeby) token potwierdzenia danej wizyty."""
    if not a.confirmation_token:
        a.confirmation_token = secrets.token_urlsafe(16)
    return a.confirmation_token


def confirm_link(token: str) -> str:
    return f"{settings.public_base_url}/potwierdz/{token}"
