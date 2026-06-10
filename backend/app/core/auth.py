# Weryfikacja tokenów Supabase Auth i RBAC.
# Frontend loguje się przez supabase-js i wysyła access token jako Bearer;
# my tylko weryfikujemy podpis (HS256, legacy JWT secret) i mapujemy
# claim `sub` na app_user.supabase_uid. Role są nasze (tabela role).
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


def decode_supabase_token(token: str) -> dict:
    try:
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience=settings.supabase_jwt_aud,
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
