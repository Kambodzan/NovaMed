# Potwierdzanie/odwołanie wizyty z linka SMS: token na wizycie
# + budowa linku do publicznej strony frontendu.
import secrets

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Appointment, AppUser


def ensure_confirm_token(a: Appointment) -> str:
    """Zwraca (tworząc w razie potrzeby) token potwierdzenia danej wizyty."""
    if not a.confirmation_token:
        a.confirmation_token = secrets.token_urlsafe(16)
    return a.confirmation_token


def confirm_link(token: str) -> str:
    return f"{settings.public_base_url}/potwierdz/{token}"


def audience_links(db: Session, a: Appointment, *, online: bool) -> tuple[str | None, str | None]:
    """Zwraca `(join_link, manage_link)` do powiadomienia o wizycie.

    Reguła JEDNA dla wszystkich ścieżek: link wstawiamy tylko gdy funkcjonalnie
    potrzebny — teleporada (online → `join_link`, żeby było jak wejść) ALBO gość
    bez konta (stacjonarnie → `manage_link`, bo nie ma aplikacji do zarządzania).
    Zalogowany pacjent + wizyta stacjonarna → brak linka (zarządza w aplikacji)."""
    user = db.get(AppUser, a.patient_id) if a.patient_id else None
    is_guest = user is not None and not bool(user.active_account)
    if not (online or is_guest):
        return None, None
    link = confirm_link(ensure_confirm_token(a))
    return (link, None) if online else (None, link)
