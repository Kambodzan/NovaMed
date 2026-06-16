from uuid import UUID
import re
import uuid
from datetime import date, datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, get_token_claims, require_roles
from app.core.config import settings
from app.core.db import get_db
from app.domain.otp import require_verified_phone
from app.models import AppUser, Patient, Role

router = APIRouter(prefix="/auth", tags=["auth"])

ROLE_PACJENT = "pacjent"


class RegisterProfileIn(BaseModel):
    first_name: str = Field(min_length=1, max_length=50)
    last_name: str = Field(min_length=1, max_length=50)
    pesel: str
    birth_date: date
    phone_number: str | None = Field(default=None, max_length=20)

    @field_validator("pesel")
    @classmethod
    def validate_pesel(cls, v: str) -> str:
        if not re.fullmatch(r"\d{11}", v):
            raise ValueError("PESEL musi składać się z 11 cyfr.")
        return v


class MeOut(BaseModel):
    user_id: UUID
    email: str
    username: str
    role: str
    active_account: bool
    first_name: str | None = None
    last_name: str | None = None
    notify_sms: bool = True


class PreferencesIn(BaseModel):
    notify_sms: bool


class DevTokenIn(BaseModel):
    email: EmailStr


@router.post("/dev-token")
def dev_token(body: DevTokenIn):
    """TYLKO DEV: zastępuje logowanie Supabase, dopóki projekt Supabase nie jest
    skonfigurowany (SUPABASE_URL puste). Token podpisany tym samym sekretem,
    którym backend weryfikuje — identyczny przepływ jak z prawdziwym Supabase.
    Tożsamość deterministyczna: sub = uuid5(email)."""
    if not settings.dev_mode or settings.supabase_url:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Niedostępne — logowanie przez Supabase.")
    sub = str(uuid.uuid5(uuid.NAMESPACE_DNS, body.email.lower()))
    token = jwt.encode(
        {
            "sub": sub,
            "email": body.email.lower(),
            "aud": settings.supabase_jwt_aud,
            "exp": datetime.now(timezone.utc) + timedelta(hours=12),
        },
        settings.supabase_jwt_secret,
        algorithm="HS256",
    )
    return {"access_token": token, "token_type": "bearer"}


@router.post("/register-profile", status_code=status.HTTP_201_CREATED, response_model=MeOut)
def register_profile(
    body: RegisterProfileIn,
    claims: dict = Depends(get_token_claims),
    db: Session = Depends(get_db),
):
    """Dokończenie rejestracji pacjenta: konto powstało w Supabase (signUp),
    tu tworzymy profil domenowy (app_user + patient). UC-P1."""
    supabase_uid = uuid.UUID(claims["sub"])
    email = claims.get("email")
    if not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Token nie zawiera adresu e-mail.")

    if db.scalar(select(AppUser).where(AppUser.supabase_uid == supabase_uid)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Profil już istnieje.")

    # Telefon (opcjonalny) musi być potwierdzony kodem SMS — żeby przypomnienia
    # realnie dochodziły, a wpięcie do kartoteki gościa po PESEL (niżej) wymagało
    # KONTROLI nad numerem, nie tylko jego znajomości (wzmocnienie anty-takeover).
    if body.phone_number:
        require_verified_phone(db, body.phone_number, "REGISTRATION")

    # PRZEJĘCIE konta gościa: pacjent założony bez konta — rezerwacja publiczna
    # (M8.6) albo przez rejestrację telefonicznie/w okienku (UC-PP1). Dopasowanie
    # najpierw po e-mailu, a gdy się nie zgadza (gość z recepcji bywa bez maila,
    # ma placeholder) — po PESEL-u, który rejestracja zawsze zbiera. Dzięki temu
    # „skoro już u nas jesteś, wpinamy Cię do istniejącej kartoteki": historia
    # wizyt/dokumentów zostaje, bez duplikatu pacjenta.
    guest = db.scalar(select(AppUser).where(
        AppUser.email == email.lower(), AppUser.active_account.is_(False)))
    # PESEL nie jest sekretem — żeby scalić kartę gościa po PESEL, wymagamy też
    # zgodnego telefonu (recepcja go zapisuje). Inaczej znajomość samego PESEL-u
    # pozwalałaby przejąć cudzą kartotekę gościa (account takeover).
    if guest is None and body.phone_number:
        gp = db.scalar(
            select(Patient).join(AppUser, AppUser.user_id == Patient.patient_id).where(
                Patient.pesel == body.pesel,
                AppUser.active_account.is_(False),
                Patient.guardian_id.is_(None),  # podopiecznych nie przejmujemy tym trybem
                AppUser.phone_number == body.phone_number.strip(),
            ))
        if gp is not None:
            guest = db.get(AppUser, gp.patient_id)
    if guest and db.get(Patient, guest.user_id) is not None:
        patient = db.get(Patient, guest.user_id)
        if patient.guardian_id is None:  # podopiecznych nie przejmujemy tym trybem
            guest.supabase_uid = supabase_uid
            guest.active_account = True
            guest.email = email.lower()  # placeholder gościa z recepcji → realny e-mail z konta
            guest.phone_number = body.phone_number or guest.phone_number
            patient.first_name, patient.last_name = body.first_name, body.last_name
            patient.pesel, patient.birth_date = body.pesel, body.birth_date
            db.commit()
            return MeOut(
                user_id=guest.user_id, email=guest.email, username=guest.username,
                role=ROLE_PACJENT, active_account=True,
                first_name=body.first_name, last_name=body.last_name,
            )

    role = db.scalar(select(Role).where(Role.role_name == ROLE_PACJENT))
    if role is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Brak roli 'pacjent' w bazie.")

    user = AppUser(
        supabase_uid=supabase_uid,
        role_id=role.role_id,
        username=email[:50],
        email=email[:100],
        phone_number=body.phone_number,
        active_account=True,
    )
    db.add(user)
    db.flush()
    db.add(Patient(
        patient_id=user.user_id,
        first_name=body.first_name,
        last_name=body.last_name,
        pesel=body.pesel,
        birth_date=body.birth_date,
        insurance_status=False,  # do weryfikacji w eWUŚ przy pierwszej wizycie
    ))
    db.commit()
    return MeOut(
        user_id=user.user_id,
        email=user.email,
        username=user.username,
        role=ROLE_PACJENT,
        active_account=True,
        first_name=body.first_name,
        last_name=body.last_name,
    )


@router.get("/me", response_model=MeOut)
def me(user: AppUser = Depends(get_current_user), db: Session = Depends(get_db)):
    patient = db.get(Patient, user.user_id)
    return MeOut(
        user_id=user.user_id,
        email=user.email,
        username=user.username,
        role=user.role.role_name,
        active_account=user.active_account,
        first_name=patient.first_name if patient else None,
        last_name=patient.last_name if patient else None,
        notify_sms=user.notify_sms,
    )


@router.patch("/me/preferences", response_model=MeOut)
def update_preferences(
    body: PreferencesIn,
    user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Preferencje powiadomień: kanał SMS włącz/wyłącz (in-app zawsze aktywne)."""
    user.notify_sms = body.notify_sms
    db.commit()
    return me(user, db)


class ProfileOut(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    pesel: str | None = None
    birth_date: date | None = None
    phone_number: str | None = None
    email: str
    insurance_status: bool = False
    notify_sms: bool = True


class ContactIn(BaseModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=50)
    last_name: str | None = Field(default=None, min_length=1, max_length=50)
    phone_number: str | None = Field(default=None, max_length=20)


def profile_out(user: AppUser, db: Session) -> ProfileOut:
    p = db.get(Patient, user.user_id)
    return ProfileOut(
        first_name=p.first_name if p else None, last_name=p.last_name if p else None,
        pesel=p.pesel if p else None, birth_date=p.birth_date if p else None,
        phone_number=user.phone_number, email=user.email,
        insurance_status=p.insurance_status if p else False, notify_sms=user.notify_sms,
    )


@router.get("/me/profile", response_model=ProfileOut)
def my_profile(user: AppUser = Depends(require_roles("pacjent")), db: Session = Depends(get_db)):
    """Profil pacjenta: dane, status ubezpieczenia (eWUŚ), preferencje."""
    return profile_out(user, db)


@router.patch("/me/contact", response_model=ProfileOut)
def update_my_contact(
    body: ContactIn,
    user: AppUser = Depends(require_roles("pacjent")),
    db: Session = Depends(get_db),
):
    """Pacjent edytuje własne dane kontaktowe (telefon, imię/nazwisko).
    PESEL i data urodzenia są niezmienne (tożsamość)."""
    p = db.get(Patient, user.user_id)
    if p is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Brak profilu pacjenta.")
    if body.phone_number is not None:
        user.phone_number = body.phone_number.strip() or None
    if body.first_name:
        p.first_name = body.first_name.strip()
    if body.last_name:
        p.last_name = body.last_name.strip()
    user.username = f"{p.first_name} {p.last_name}"
    db.commit()
    return profile_out(user, db)
