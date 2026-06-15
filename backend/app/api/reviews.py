from uuid import UUID
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_roles
from app.core.db import get_db
from app.domain.appointments import AppointmentStatus
from app.models import Appointment, AppUser, Doctor, Review

router = APIRouter(prefix="/reviews", tags=["reviews"])

REVIEW_EDIT_DAYS = 14   # UC-P8 A2: opinię można edytować w określonym czasie


class ReviewIn(BaseModel):
    """UC-P8: ocena lekarza i/lub kliniki po odbytej wizycie — minimum jedna z dwóch."""

    appointment_id: UUID
    doctor_rating: int | None = Field(default=None, ge=1, le=5)
    doctor_comment: str | None = None
    clinic_rating: int | None = Field(default=None, ge=1, le=5)
    clinic_comment: str | None = None

    @model_validator(mode="after")
    def at_least_one(self):
        if self.doctor_rating is None and self.clinic_rating is None:
            raise ValueError("Podaj ocenę lekarza, kliniki lub obie.")
        return self


class ReviewOut(BaseModel):
    review_id: UUID
    rating: int
    comment: str | None
    created_at: datetime
    target: str  # "doctor" | "clinic"


class DoctorReviewsOut(BaseModel):
    doctor_id: UUID
    average: float | None
    count: int
    items: list[ReviewOut]


@router.post("", status_code=status.HTTP_201_CREATED, response_model=list[ReviewOut])
def create_review(
    body: ReviewIn,
    user: AppUser = Depends(require_roles("pacjent")),
    db: Session = Depends(get_db),
):
    from app.api.family import allowed_patient_ids  # import lokalny — unika cyklu

    a = db.get(Appointment, body.appointment_id)
    if a is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wizyta nie istnieje.")
    if a.patient_id not in allowed_patient_ids(db, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="To nie jest Twoja wizyta.")
    if a.doctor_id is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Opinie wystawia się po wizytach lekarskich, nie po badaniach.")
    if a.appointment_status != AppointmentStatus.COMPLETED.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Wizyta nie jest zakończona — brak możliwości wystawienia opinii (UC-P8 A1).",
        )

    def upsert(target_filter, rating, comment, **new_kwargs) -> Review:
        # UPSERT z oknem edycji: ponowne wystawienie = edycja opinii (UC-P8 A2)
        existing = db.scalar(select(Review).where(
            Review.appointment_id == a.appointment_id, target_filter))
        if existing:
            if (datetime.now() - existing.created_at) > timedelta(days=REVIEW_EDIT_DAYS):
                raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                    detail=f"Minął czas na edycję opinii ({REVIEW_EDIT_DAYS} dni od wystawienia).")
            existing.rating, existing.comment = rating, comment
            return existing
        new = Review(user_id=user.user_id, appointment_id=a.appointment_id,
                     rating=rating, comment=comment, **new_kwargs)
        db.add(new)
        return new

    result: list[Review] = []
    if body.doctor_rating is not None:
        result.append(upsert(Review.doctor_id.is_not(None), body.doctor_rating, body.doctor_comment,
                             doctor_id=a.doctor_id))
    if body.clinic_rating is not None:
        result.append(upsert(Review.clinic_id.is_not(None), body.clinic_rating, body.clinic_comment,
                             clinic_id=a.clinic_id))
    db.commit()
    return [
        ReviewOut(review_id=r.review_id, rating=r.rating, comment=r.comment,
                  created_at=r.created_at, target="doctor" if r.doctor_id else "clinic")
        for r in result
    ]


class MyReviewOut(BaseModel):
    doctor_rating: int | None = None
    doctor_comment: str | None = None
    clinic_rating: int | None = None
    editable: bool = True   # czy w oknie edycji


@router.get("/mine/{appointment_id}", response_model=MyReviewOut)
def my_review(
    appointment_id: UUID,
    user: AppUser = Depends(require_roles("pacjent")),
    db: Session = Depends(get_db),
):
    """Opinia pacjenta dla wizyty (do podglądu/edycji)."""
    from app.api.family import allowed_patient_ids

    a = db.get(Appointment, appointment_id)
    if a is None or a.patient_id not in allowed_patient_ids(db, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="To nie jest Twoja wizyta.")
    rows = db.scalars(select(Review).where(Review.appointment_id == appointment_id)).all()
    out = MyReviewOut()
    for r in rows:
        if r.doctor_id:
            out.doctor_rating, out.doctor_comment = r.rating, r.comment
        else:
            out.clinic_rating = r.rating
        if (datetime.now() - r.created_at) > timedelta(days=REVIEW_EDIT_DAYS):
            out.editable = False
    return out


@router.get("/doctor/{doctor_id}", response_model=DoctorReviewsOut)
def doctor_reviews(
    doctor_id: UUID,
    _: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if db.get(Doctor, doctor_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lekarz nie istnieje.")
    rows = db.scalars(
        select(Review).where(Review.doctor_id == doctor_id).order_by(Review.created_at.desc())
    ).all()
    avg = db.scalar(select(func.avg(Review.rating)).where(Review.doctor_id == doctor_id))
    return DoctorReviewsOut(
        doctor_id=doctor_id,
        average=round(float(avg), 2) if avg is not None else None,
        count=len(rows),
        items=[
            ReviewOut(review_id=r.review_id, rating=r.rating, comment=r.comment,
                      created_at=r.created_at, target="doctor")
            for r in rows
        ],
    )
