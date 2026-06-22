from uuid import UUID
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import get_current_user, require_roles
from app.core.db import get_db
from app.domain.audit import log_access
from app.domain.tenancy import assert_staff_in_clinic
from app.models import Appointment, AppUser, Clinic, Doctor, DoctorService, Patient, PatientClinic, Service, StaffClinic

router = APIRouter(prefix="/clinics", tags=["clinics"])

# Obsługa pacjenta przy ladzie (front-desk) — rejestracja i wyżej.
RECEPTION = ("rejestracja", "kierownik", "administrator")
# Zarządzanie placówką (personel, polityka) — tylko kierownik SWOJEJ placówki i admin.
CLINIC_MANAGERS = ("kierownik", "administrator")


class ClinicIn(BaseModel):
    clinic_name: str = Field(min_length=1, max_length=100)
    address: str = Field(min_length=1, max_length=255)
    city: str | None = Field(default=None, max_length=60)
    lat: float | None = None
    lng: float | None = None
    photo_url: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=20)
    clinic_email: str | None = Field(default=None, max_length=100)


class ClinicOut(ClinicIn):
    clinic_id: UUID
    earlier_notice_min_hours: int = 24
    slot_interval_min: int = 15
    reminder_mode: str = "REMINDER"   # NONE / REMINDER / CONFIRM
    confirmation_required: bool = False
    confirmation_hours: int = 48


class ClinicSettingsIn(BaseModel):
    earlier_notice_min_hours: int = Field(ge=0, le=720, description="Min. wyprzedzenie [h] powiadomień o wcześniejszym terminie")
    slot_interval_min: int = Field(default=15, ge=5, le=120, description="Siatka terminów [min] — np. 15 lub 20")
    # nowy, 3-pozycyjny tryb przypomnień; confirmation_required pozostaje dla zgodności
    reminder_mode: str | None = Field(default=None, description="NONE / REMINDER / CONFIRM")
    confirmation_required: bool = Field(default=False, description="(legacy) potwierdzanie obecności = reminder_mode CONFIRM")
    confirmation_hours: int = Field(default=48, ge=2, le=336, description="Ile godzin przed wizytą wysłać prośbę o potwierdzenie")


class StaffAssignIn(BaseModel):
    user_id: UUID
    start_date: date | None = None


class DoctorOut(BaseModel):
    doctor_id: UUID
    name: str
    specializations: list[str] = []
    academic_title: str | None
    slot_duration_min: int | None = None  # długość wizyty [min]; None = siatka placówki
    room: str | None = None               # stały gabinet w tej placówce


class DoctorVisitLengthIn(BaseModel):
    # None = przywróć domyślną siatkę placówki; inaczej własna długość wizyty lekarza
    slot_duration_min: int | None = Field(default=None, ge=5, le=120)


class DoctorRoomIn(BaseModel):
    room: str | None = Field(default=None, max_length=20)


class PatientAssignIn(BaseModel):
    patient_id: UUID


class PatientOut(BaseModel):
    patient_id: UUID
    first_name: str
    last_name: str
    pesel: str
    insurance_status: bool
    phone_number: str | None = None


def get_clinic_or_404(clinic_id: UUID, db: Session) -> Clinic:
    clinic = db.get(Clinic, clinic_id)
    if clinic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Placówka nie istnieje.")
    return clinic


@router.post("", status_code=status.HTTP_201_CREATED, response_model=ClinicOut)
def create_clinic(
    body: ClinicIn,
    _: AppUser = Depends(require_roles("administrator")),
    db: Session = Depends(get_db),
):
    clinic = Clinic(**body.model_dump())
    db.add(clinic)
    db.commit()
    return clinic_out(clinic)


def clinic_out(c: Clinic) -> ClinicOut:
    return ClinicOut(
        clinic_id=c.clinic_id, clinic_name=c.clinic_name, address=c.address,
        phone=c.phone, clinic_email=c.clinic_email, city=c.city, lat=c.lat, lng=c.lng,
        photo_url=c.photo_url,
        earlier_notice_min_hours=c.earlier_notice_min_hours,
        slot_interval_min=c.slot_interval_min,
        reminder_mode=c.reminder_mode,
        confirmation_required=c.confirmation_required,
        confirmation_hours=c.confirmation_hours,
    )


@router.get("", response_model=list[ClinicOut])
def list_clinics(db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    return [clinic_out(c) for c in db.scalars(select(Clinic).order_by(Clinic.clinic_name))]


@router.patch("/{clinic_id}/settings", response_model=ClinicOut)
def update_clinic_settings(
    clinic_id: UUID,
    body: ClinicSettingsIn,
    user: AppUser = Depends(require_roles("kierownik", "administrator")),
    db: Session = Depends(get_db),
):
    """Ustawienia placówki (polityka: wyprzedzenie powiadomień, siatka terminów,
    tryb przypomnień/potwierdzania). To decyzje OPERACYJNE placówki — może je
    zmieniać kierownik SWOJEJ placówki albo administrator, nie rejestracja."""
    clinic = get_clinic_or_404(clinic_id, db)
    assert_staff_in_clinic(db, user, clinic_id)
    clinic.earlier_notice_min_hours = body.earlier_notice_min_hours
    clinic.slot_interval_min = body.slot_interval_min
    clinic.confirmation_hours = body.confirmation_hours
    # reminder_mode jest źródłem prawdy; gdy podano (nowy front) — z niego liczymy
    # confirmation_required. Gdy nie (legacy/testy) — odwrotnie z confirmation_required.
    if body.reminder_mode in ("NONE", "REMINDER", "CONFIRM"):
        clinic.reminder_mode = body.reminder_mode
        clinic.confirmation_required = body.reminder_mode == "CONFIRM"
    else:
        clinic.confirmation_required = body.confirmation_required
        clinic.reminder_mode = "CONFIRM" if body.confirmation_required else "REMINDER"
    db.commit()
    return clinic_out(clinic)


@router.post("/{clinic_id}/staff", status_code=status.HTTP_201_CREATED)
def assign_staff(
    clinic_id: UUID,
    body: StaffAssignIn,
    user: AppUser = Depends(require_roles(*CLINIC_MANAGERS)),
    db: Session = Depends(get_db),
):
    """UC-PP1: przypisanie pracownika (lekarz/pielęgniarka/rejestracja) do placówki.
    Decyzja kadrowa — tylko kierownik SWOJEJ placówki albo administrator (admin bez
    ograniczeń; on zakłada pierwszego kierownika nowej placówki)."""
    get_clinic_or_404(clinic_id, db)
    assert_staff_in_clinic(db, user, clinic_id)
    if db.get(AppUser, body.user_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Użytkownik nie istnieje.")
    exists = db.scalar(select(StaffClinic).where(
        StaffClinic.clinic_id == clinic_id,
        StaffClinic.user_id == body.user_id,
        StaffClinic.end_date.is_(None),
    ))
    if exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Pracownik jest już przypisany do tej placówki.")
    db.add(StaffClinic(clinic_id=clinic_id, user_id=body.user_id, start_date=body.start_date or date.today()))
    db.commit()
    return {"status": "ok"}


@router.get("/{clinic_id}/doctors", response_model=list[DoctorOut])
def list_clinic_doctors(
    clinic_id: UUID,
    db: Session = Depends(get_db),
    _: AppUser = Depends(get_current_user),
):
    get_clinic_or_404(clinic_id, db)
    rows = db.execute(
        select(Doctor, AppUser, StaffClinic)
        .join(AppUser, AppUser.user_id == Doctor.doctor_id)
        .join(StaffClinic, StaffClinic.user_id == Doctor.doctor_id)
        .where(StaffClinic.clinic_id == clinic_id, StaffClinic.end_date.is_(None))
    ).all()
    return [
        DoctorOut(
            doctor_id=d.doctor_id, name=u.username,
            specializations=list(d.specialization_names), academic_title=d.academic_title,
            slot_duration_min=d.slot_duration_min, room=sc.room,
        )
        for d, u, sc in rows
    ]


@router.patch("/{clinic_id}/doctors/{doctor_id}/visit-length")
def set_doctor_visit_length(
    clinic_id: UUID,
    doctor_id: UUID,
    body: DoctorVisitLengthIn,
    user: AppUser = Depends(require_roles("kierownik", "administrator")),
    db: Session = Depends(get_db),
):
    """Długość wizyty (krok siatki terminów) konkretnego lekarza — np. jeden przyjmuje
    co 15 min, inny co 30. Ustawia kierownik SWOJEJ placówki albo administrator;
    lekarz musi być w niej zatrudniony. None = powrót do siatki placówki."""
    get_clinic_or_404(clinic_id, db)
    assert_staff_in_clinic(db, user, clinic_id)
    doctor = db.get(Doctor, doctor_id)
    if doctor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lekarz nie istnieje.")
    works_here = db.scalar(select(StaffClinic).where(
        StaffClinic.clinic_id == clinic_id, StaffClinic.user_id == doctor_id, StaffClinic.end_date.is_(None),
    ))
    if not works_here:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Lekarz nie jest przypisany do tej placówki.")
    doctor.slot_duration_min = body.slot_duration_min
    db.commit()
    return {"doctor_id": str(doctor_id), "slot_duration_min": doctor.slot_duration_min}


@router.patch("/{clinic_id}/doctors/{doctor_id}/room")
def set_doctor_room(
    clinic_id: UUID,
    doctor_id: UUID,
    body: DoctorRoomIn,
    user: AppUser = Depends(require_roles("kierownik", "administrator")),
    db: Session = Depends(get_db),
):
    """Stały gabinet lekarza w tej placówce — ustawia kierownik/administrator. Używany
    przy meldowaniu pacjenta przez recepcję (nie wpisuje go ręcznie). Per placówka,
    bo lekarz może przyjmować w różnych gabinetach w różnych placówkach."""
    get_clinic_or_404(clinic_id, db)
    assert_staff_in_clinic(db, user, clinic_id)
    sc = db.scalar(select(StaffClinic).where(
        StaffClinic.clinic_id == clinic_id, StaffClinic.user_id == doctor_id, StaffClinic.end_date.is_(None)))
    if sc is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Lekarz nie jest przypisany do tej placówki.")
    sc.room = (body.room or "").strip() or None
    db.commit()
    return {"doctor_id": str(doctor_id), "room": sc.room}


@router.post("/{clinic_id}/patients", status_code=status.HTTP_201_CREATED)
def assign_patient(
    clinic_id: UUID,
    body: PatientAssignIn,
    _: AppUser = Depends(require_roles(*RECEPTION)),
    db: Session = Depends(get_db),
):
    """UC-PP3: przypisanie pacjenta do placówki."""
    get_clinic_or_404(clinic_id, db)
    if db.get(Patient, body.patient_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pacjent nie istnieje.")
    exists = db.scalar(select(PatientClinic).where(
        PatientClinic.clinic_id == clinic_id, PatientClinic.patient_id == body.patient_id,
    ))
    if exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Pacjent jest już przypisany do tej placówki.")
    db.add(PatientClinic(clinic_id=clinic_id, patient_id=body.patient_id, assigned_date=date.today()))
    db.commit()
    return {"status": "ok"}


@router.get("/{clinic_id}/patients", response_model=list[PatientOut])
def list_clinic_patients(
    clinic_id: UUID,
    user: AppUser = Depends(require_roles(*RECEPTION, "lekarz", "pielegniarka")),
    db: Session = Depends(get_db),
):
    get_clinic_or_404(clinic_id, db)
    assert_staff_in_clinic(db, user, clinic_id)
    log_access(db, actor=user, action="VIEW_PATIENT_LIST", detail=f"placowka {clinic_id}")
    # widoczni pacjenci placówki = jawnie przypisani (patient_clinic) LUB mający
    # ślad wizytowy w tej placówce (gość publiczny/telefoniczny też ma wizytę, a
    # nie dostaje patient_clinic) — spójnie ze śladem z kontroli dostępu (#25),
    # inaczej recepcja nie znalazłaby gościa, by np. dodać mu wynik badania.
    in_clinic = (
        select(PatientClinic.patient_id).where(PatientClinic.clinic_id == clinic_id)
        .union(select(Appointment.patient_id).where(
            Appointment.clinic_id == clinic_id, Appointment.patient_id.is_not(None)))
    )
    rows = db.execute(
        select(Patient, AppUser.phone_number)
        .join(AppUser, AppUser.user_id == Patient.patient_id)
        .where(Patient.patient_id.in_(in_clinic))
        .order_by(Patient.last_name)
    ).all()
    return [
        PatientOut(
            patient_id=p.patient_id, first_name=p.first_name, last_name=p.last_name,
            pesel=p.pesel, insurance_status=p.insurance_status, phone_number=phone,
        )
        for p, phone in rows
    ]


# ---- katalog usług placówki (typy wizyt/przyjęć) ----

class ServiceIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    specialization: str | None = Field(default=None, max_length=100)
    duration_min: int = Field(default=15, ge=5, le=240)
    price: float | None = Field(default=None, ge=0)   # NULL = NFZ/bezpłatna
    referral_required: bool = False
    allow_online: bool = False   # czy usługę można odbyć jako teleporadę (konsultacja: tak)
    description: str | None = Field(default=None, max_length=1000)


class ServiceOut(ServiceIn):
    service_id: UUID
    clinic_id: UUID
    active: bool
    doctor_ids: list[UUID] = []   # którzy lekarze wykonują tę usługę


class ServiceDoctorsIn(BaseModel):
    doctor_ids: list[UUID]


def service_out(s: Service) -> ServiceOut:
    return ServiceOut(
        service_id=s.service_id, clinic_id=s.clinic_id, name=s.name, specialization=s.specialization,
        duration_min=s.duration_min, price=float(s.price) if s.price is not None else None,
        referral_required=s.referral_required, allow_online=s.allow_online, description=s.description, active=s.active,
        doctor_ids=[ds.doctor_id for ds in s.doctors],
    )


def get_service_in_clinic(clinic_id: UUID, service_id: UUID, db: Session) -> Service:
    s = db.get(Service, service_id)
    if s is None or s.clinic_id != clinic_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usługa nie istnieje w tej placówce.")
    return s


@router.get("/{clinic_id}/services", response_model=list[ServiceOut])
def list_services(clinic_id: UUID, db: Session = Depends(get_db), _: AppUser = Depends(get_current_user)):
    """Katalog aktywnych usług placówki (typy wizyt) z listą wykonujących lekarzy."""
    get_clinic_or_404(clinic_id, db)
    rows = db.scalars(select(Service).where(
        Service.clinic_id == clinic_id, Service.active.is_(True)).order_by(Service.name))
    return [service_out(s) for s in rows]


@router.post("/{clinic_id}/services", status_code=status.HTTP_201_CREATED, response_model=ServiceOut)
def create_service(
    clinic_id: UUID,
    body: ServiceIn,
    user: AppUser = Depends(require_roles(*CLINIC_MANAGERS)),
    db: Session = Depends(get_db),
):
    """Nowa usługa w katalogu placówki — kierownik SWOJEJ placówki albo administrator."""
    get_clinic_or_404(clinic_id, db)
    assert_staff_in_clinic(db, user, clinic_id)
    s = Service(clinic_id=clinic_id, **body.model_dump())
    db.add(s)
    db.commit()
    return service_out(s)


@router.patch("/{clinic_id}/services/{service_id}", response_model=ServiceOut)
def update_service(
    clinic_id: UUID,
    service_id: UUID,
    body: ServiceIn,
    user: AppUser = Depends(require_roles(*CLINIC_MANAGERS)),
    db: Session = Depends(get_db),
):
    assert_staff_in_clinic(db, user, clinic_id)
    s = get_service_in_clinic(clinic_id, service_id, db)
    for k, v in body.model_dump().items():
        setattr(s, k, v)
    db.commit()
    return service_out(s)


@router.delete("/{clinic_id}/services/{service_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_service(
    clinic_id: UUID,
    service_id: UUID,
    user: AppUser = Depends(require_roles(*CLINIC_MANAGERS)),
    db: Session = Depends(get_db),
):
    """Wycofanie usługi z katalogu (soft delete — istniejące terminy zostają)."""
    assert_staff_in_clinic(db, user, clinic_id)
    s = get_service_in_clinic(clinic_id, service_id, db)
    s.active = False
    db.commit()


@router.put("/{clinic_id}/services/{service_id}/doctors", response_model=ServiceOut)
def set_service_doctors(
    clinic_id: UUID,
    service_id: UUID,
    body: ServiceDoctorsIn,
    user: AppUser = Depends(require_roles(*CLINIC_MANAGERS)),
    db: Session = Depends(get_db),
):
    """Ustawia, którzy lekarze wykonują usługę (przypięcie/synchronizacja). Lekarze
    muszą pracować w tej placówce."""
    assert_staff_in_clinic(db, user, clinic_id)
    s = get_service_in_clinic(clinic_id, service_id, db)
    wanted = set(body.doctor_ids)
    for did in wanted:
        works = db.scalar(select(StaffClinic).where(
            StaffClinic.clinic_id == clinic_id, StaffClinic.user_id == did, StaffClinic.end_date.is_(None)))
        if not works:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Lekarz nie jest przypisany do tej placówki.")
    current = {ds.doctor_id: ds for ds in s.doctors}
    for did in wanted - set(current):
        db.add(DoctorService(doctor_id=did, service_id=service_id))
    for did in set(current) - wanted:
        db.delete(current[did])
    db.commit()
    db.refresh(s)
    return service_out(s)
