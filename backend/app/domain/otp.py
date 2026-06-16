# Wspólny mechanizm OTP (kod SMS) dla ścieżek BEZ logowania — publiczna rezerwacja
# i potwierdzenie telefonu przy rejestracji. Dowód kontroli nad numerem: anty-spam
# (nie zarezerwujesz na cudzy numer) i pewność, że przypomnienia realnie dochodzą.
# Kanał SMS jest best-effort (jak w całym systemie) — awaria bramki
# nie blokuje wygenerowania kodu; w DEV kod wraca też w odpowiedzi (Twilio trial
# dostarcza tylko na zweryfikowany numer, więc demo korzysta z fallbacku DEV/mock).
import hashlib
import secrets
from datetime import datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.integrations.sms import _to_e164, get_sms_client
from app.models import PhoneVerification

PURPOSES = ("BOOKING", "REGISTRATION")
CODE_TTL_MIN = 10        # ważność wysłanego kodu
VERIFIED_TTL_MIN = 30    # jak długo „numer potwierdzony" jest ważny do akcji
MAX_ATTEMPTS = 5         # błędne próby na jeden kod, potem trzeba wysłać nowy
SEND_WINDOW_MIN = 15     # okno limitu wysyłek
SEND_LIMIT = 4           # max kodów na numer+cel w oknie (anty-abuse / koszt SMS)


def normalize_phone(raw: str) -> str:
    return _to_e164(raw)


def _hash(phone: str, code: str) -> str:
    return hashlib.sha256(f"{phone}:{code}".encode()).hexdigest()


def _require_purpose(purpose: str) -> None:
    if purpose not in PURPOSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nieznany cel weryfikacji.")


def send_otp(db: Session, phone_raw: str, purpose: str) -> str:
    """Generuje i wysyła 6-cyfrowy kod; zwraca go (caller decyduje, czy ujawnić w DEV)."""
    _require_purpose(purpose)
    phone = normalize_phone(phone_raw)
    window_start = datetime.now() - timedelta(minutes=SEND_WINDOW_MIN)
    recent = db.scalar(select(func.count()).select_from(PhoneVerification).where(
        PhoneVerification.phone == phone,
        PhoneVerification.purpose == purpose,
        PhoneVerification.created_at >= window_start,
    )) or 0
    if recent >= SEND_LIMIT:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail="Wysłaliśmy już kilka kodów na ten numer — odczekaj kilka minut.")
    code = f"{secrets.randbelow(1_000_000):06d}"
    db.add(PhoneVerification(
        phone=phone, purpose=purpose, code_hash=_hash(phone, code),
        # created_at jawnie (nie server_default) — żeby okno limitu liczyło się tym
        # samym zegarem co datetime.now() (server_default func.now() bywa w UTC)
        created_at=datetime.now(),
        expires_at=datetime.now() + timedelta(minutes=CODE_TTL_MIN),
    ))
    db.commit()
    get_sms_client().send(to=phone, message=f"Kod weryfikacyjny NovaMed: {code} (wazny {CODE_TTL_MIN} min).")
    return code


def verify_otp(db: Session, phone_raw: str, code: str, purpose: str) -> None:
    """Sprawdza kod; przy poprawnym oznacza numer jako zweryfikowany (verified_at)."""
    _require_purpose(purpose)
    phone = normalize_phone(phone_raw)
    row = db.scalar(select(PhoneVerification).where(
        PhoneVerification.phone == phone,
        PhoneVerification.purpose == purpose,
        PhoneVerification.consumed_at.is_(None),
    ).order_by(PhoneVerification.created_at.desc()))
    if row is None or row.expires_at < datetime.now():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Kod wygasł lub nie istnieje — wyślij nowy.")
    if row.attempts >= MAX_ATTEMPTS:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail="Zbyt wiele prób — wyślij nowy kod.")
    if row.code_hash != _hash(phone, code):
        row.attempts += 1
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nieprawidłowy kod.")
    row.verified_at = datetime.now()
    db.commit()


def consume_verified(db: Session, phone_raw: str, purpose: str) -> bool:
    """Spożywa świeży, zweryfikowany numer (jednorazowo). True = był potwierdzony."""
    _require_purpose(purpose)
    phone = normalize_phone(phone_raw)
    fresh = datetime.now() - timedelta(minutes=VERIFIED_TTL_MIN)
    row = db.scalar(select(PhoneVerification).where(
        PhoneVerification.phone == phone,
        PhoneVerification.purpose == purpose,
        PhoneVerification.consumed_at.is_(None),
        PhoneVerification.verified_at.is_not(None),
        PhoneVerification.verified_at >= fresh,
    ).order_by(PhoneVerification.verified_at.desc()))
    if row is None:
        return False
    row.consumed_at = datetime.now()
    db.commit()
    return True


def require_verified_phone(db: Session, phone_raw: str, purpose: str) -> None:
    if not consume_verified(db, phone_raw, purpose):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Najpierw potwierdź numer telefonu kodem SMS.")
