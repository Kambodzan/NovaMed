# Weryfikacja tokenów Supabase Auth i RBAC.
# Frontend loguje się przez supabase-js i wysyła access token jako Bearer;
# my tylko weryfikujemy podpis i mapujemy claim `sub` na app_user.supabase_uid.
# Role są nasze (tabela role).
#
# Dwa algorytmy podpisu:
# - ES256 (domyślny w nowych projektach Supabase) — klucz publiczny z JWKS
#   projektu (cache w PyJWKClient, jedno pobranie);
# - HS256 — legacy secret; używany też przez /auth/dev-token i testy.
import uuid

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.models import AppUser

bearer_scheme = HTTPBearer(auto_error=False)

_jwks_client: jwt.PyJWKClient | None = None


def _jwks() -> jwt.PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = jwt.PyJWKClient(
            f"{settings.supabase_url}/auth/v1/.well-known/jwks.json", cache_keys=True,
        )
    return _jwks_client


# Tolerancja na przesunięcie zegara maszyny względem Supabase: świeży token ma
# iat = "teraz" serwera auth; przy zegarze spóźnionym o ułamek sekundy PyJWT
# odrzucałby go jako ImmatureSignature (objaw: losowe 401 tuż po zalogowaniu).
CLOCK_LEEWAY_S = 10


def decode_supabase_token(token: str) -> dict:
    try:
        header = jwt.get_unverified_header(token)
        if header.get("alg") == "ES256" and settings.supabase_url:
            key = _jwks().get_signing_key_from_jwt(token).key
            return jwt.decode(token, key, algorithms=["ES256"],
                              audience=settings.supabase_jwt_aud, leeway=CLOCK_LEEWAY_S)
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience=settings.supabase_jwt_aud,
            leeway=CLOCK_LEEWAY_S,
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Nieprawidłowy lub wygasły token uwierzytelniający.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def get_token_claims(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Brak tokenu uwierzytelniającego.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return decode_supabase_token(credentials.credentials)


def get_current_user(
    claims: dict = Depends(get_token_claims),
    db: Session = Depends(get_db),
) -> AppUser:
    supabase_uid = uuid.UUID(claims["sub"])
    user = db.scalar(select(AppUser).where(AppUser.supabase_uid == supabase_uid))
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Konto istnieje w Supabase, ale nie ma profilu w NovaMed. Dokończ rejestrację.",
        )
    if not user.active_account:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Konto jest zablokowane.")
    return user


def require_roles(*role_names: str):
    """Dependency factory: dostęp tylko dla wskazanych ról (np. require_roles('lekarz'))."""

    def checker(user: AppUser = Depends(get_current_user)) -> AppUser:
        if user.role.role_name not in role_names:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Brak uprawnień do tego zasobu.",
            )
        return user

    return checker
