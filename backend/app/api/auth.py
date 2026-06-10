import re
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, get_token_claims
from app.core.db import get_db
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
    user_id: int
    email: str
    username: str
    role: str
    active_account: bool


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
    )


@router.get("/me", response_model=MeOut)
def me(user: AppUser = Depends(get_current_user)):
    return MeOut(
        user_id=user.user_id,
        email=user.email,
        username=user.username,
        role=user.role.role_name,
        active_account=user.active_account,
    )
