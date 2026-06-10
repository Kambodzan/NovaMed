from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_roles
from app.core.db import get_db
from app.domain.appointments import AppointmentStatus
from app.models import Appointment, AppUser, Doctor, Review

router = APIRouter(prefix="/reviews", tags=["reviews"])


class ReviewIn(BaseModel):
    """UC-P8: ocena lekarza i/lub kliniki po odbytej wizycie — minimum jedna z dwóch."""

    appointment_id: int
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
    review_id: int
    rating: int
    comment: str | None
    created_at: datetime
    target: str  # "doctor" | "clinic"


class DoctorReviewsOut(BaseModel):
    doctor_id: int
    average: float | None
    count: int
    items: list[ReviewOut]


@router.post("", status_code=status.HTTP_201_CREATED, response_model=list[ReviewOut])
def create_review(
    body: ReviewIn,
    user: AppUser = Depends(require_roles("pacjent")),
    db: Session = Depends(get_db),
):
    a = db.get(Appointment, body.appointment_id)
    if a is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wizyta nie istnieje.")
    if a.patient_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="To nie jest Twoja wizyta.")
    if a.appointment_status != AppointmentStatus.COMPLETED.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Wizyta nie jest zakończona — brak możliwości wystawienia opinii (UC-P8 A1).",
        )

    created: list[Review] = []
    if body.doctor_rating is not None:
        dup = db.scalar(select(Review).where(
            Review.appointment_id == a.appointment_id, Review.doctor_id.is_not(None),
        ))
        if dup:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Opinia o lekarzu dla tej wizyty już istnieje.")
        created.append(Review(
            user_id=user.user_id, appointment_id=a.appointment_id,
            doctor_id=a.doctor_id, rating=body.doctor_rating, comment=body.doctor_comment,
        ))
    if body.clinic_rating is not None:
        dup = db.scalar(select(Review).where(
            Review.appointment_id == a.appointment_id, Review.clinic_id.is_not(None),
        ))
        if dup:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Opinia o placówce dla tej wizyty już istnieje.")
        created.append(Review(
            user_id=user.user_id, appointment_id=a.appointment_id,
            clinic_id=a.clinic_id, rating=body.clinic_rating, comment=body.clinic_comment,
        ))
    db.add_all(created)
    db.commit()
    return [
        ReviewOut(
            review_id=r.review_id, rating=r.rating, comment=r.comment,
            created_at=r.created_at, target="doctor" if r.doctor_id else "clinic",
        )
        for r in created
    ]


@router.get("/doctor/{doctor_id}", response_model=DoctorReviewsOut)
def doctor_reviews(
    doctor_id: int,
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
