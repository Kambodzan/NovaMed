# Seed danych demo (dev). Uruchomienie:
#   .\.venv\Scripts\python.exe -m app.seed_dev
# Idempotentny — pomija istniejące konta (po e-mailu).
# Tożsamości: sub = uuid5(email) — zgodnie z /auth/dev-token, więc logowanie
# dev-owe trafia w te same konta.
import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import select

from app.core.db import SessionLocal
from app.domain.appointments import AppointmentStatus, AppointmentType
from app.models import (
    Appointment, AppUser, Clinic, Doctor, DocumentShare, LabResult,
    MedicalDocument, Nurse, NursingProcedure, Patient, PatientClinic,
    Prescription, Referral, Role, SickLeave, StaffClinic, WaitingListEntry,
)

DOCTORS = [
    ("a.kowalczyk@novamed.dev", "dr n. med. Anna Kowalczyk", "Kardiolog", "dr n. med."),
    ("t.zielinski@novamed.dev", "lek. Tomasz Zieliński", "Internista", "lek."),
    ("m.nowicka@novamed.dev", "dr hab. n. med. Maria Nowicka", "Endokrynolog", "dr hab. n. med."),
]


def sub_for(email: str) -> uuid.UUID:
    return uuid.uuid5(uuid.NAMESPACE_DNS, email.lower())


def get_or_create_user(db, email: str, username: str, role_name: str) -> AppUser:
    user = db.scalar(select(AppUser).where(AppUser.email == email))
    if user:
        return user
    role = db.scalar(select(Role).where(Role.role_name == role_name))
    user = AppUser(
        supabase_uid=sub_for(email),
        role_id=role.role_id,
        username=username[:50],
        email=email,
        active_account=True,
    )
    db.add(user)
    db.flush()
    return user


def main() -> None:
    db = SessionLocal()

    clinic = db.scalar(select(Clinic).where(Clinic.clinic_name == "Przychodnia „Zdrowa Rodzina”"))
    if clinic is None:
        clinic = Clinic(
            clinic_name="Przychodnia „Zdrowa Rodzina”",
            address="ul. Słowackiego 12, 05-820 Piastów",
            phone="22 723 45 67",
            clinic_email="kontakt@zdrowarodzina.pl",
        )
        db.add(clinic)
        db.flush()

    # personel
    doctor_ids: list[int] = []
    for email, name, spec, title in DOCTORS:
        u = get_or_create_user(db, email, name, "lekarz")
        if db.get(Doctor, u.user_id) is None:
            db.add(Doctor(doctor_id=u.user_id, license_number="1234567", specialization=spec, academic_title=title))
        if not db.scalar(select(StaffClinic).where(StaffClinic.clinic_id == clinic.clinic_id, StaffClinic.user_id == u.user_id)):
            db.add(StaffClinic(clinic_id=clinic.clinic_id, user_id=u.user_id, start_date=date(2025, 1, 1)))
        doctor_ids.append(u.user_id)

    nurse_u = get_or_create_user(db, "k.lis@novamed.dev", "piel. Katarzyna Lis", "pielegniarka")
    if db.get(Nurse, nurse_u.user_id) is None:
        db.add(Nurse(nurse_id=nurse_u.user_id, license_number="7654321"))
    get_or_create_user(db, "rejestracja@novamed.dev", "Barbara Krawczyk", "rejestracja")
    get_or_create_user(db, "admin@novamed.dev", "Administrator", "administrator")

    # pacjentka demo
    pat_u = get_or_create_user(db, "janina.wisniewska@novamed.dev", "Janina Wiśniewska", "pacjent")
    if db.get(Patient, pat_u.user_id) is None:
        db.add(Patient(
            patient_id=pat_u.user_id, first_name="Janina", last_name="Wiśniewska",
            pesel="52041512345", birth_date=date(1952, 4, 15), insurance_status=True,
        ))

    # wolne sloty: najbliższe 7 dni, 4 sloty dziennie na lekarza
    existing_slots = db.scalar(
        select(Appointment.appointment_id).where(Appointment.appointment_status == AppointmentStatus.FREE.value).limit(1)
    )
    created_slots = 0
    if existing_slots is None:
        base = datetime.now().replace(minute=0, second=0, microsecond=0)
        for day in range(1, 8):
            for di, doctor_id in enumerate(doctor_ids):
                for hour in (8, 10, 12, 15):
                    db.add(Appointment(
                        patient_id=None,
                        doctor_id=doctor_id,
                        clinic_id=clinic.clinic_id,
                        appointment_datetime=base.replace(hour=hour) + timedelta(days=day, minutes=di * 20),
                        appointment_status=AppointmentStatus.FREE.value,
                        appointment_type=(AppointmentType.ONLINE if hour == 15 else AppointmentType.STATIONARY).value,
                    ))
                    created_slots += 1

    # płatne sloty prywatne (M6): endokrynolog 220 zł, teleporady kardiologa 150 zł
    has_priced = db.scalar(
        select(Appointment.appointment_id).where(Appointment.price.is_not(None)).limit(1)
    )
    if has_priced is None:
        base = datetime.now().replace(minute=0, second=0, microsecond=0)
        for day in range(1, 5):
            db.add(Appointment(
                patient_id=None, doctor_id=doctor_ids[2], clinic_id=clinic.clinic_id,
                appointment_datetime=base.replace(hour=17) + timedelta(days=day),
                appointment_status=AppointmentStatus.FREE.value,
                appointment_type=AppointmentType.STATIONARY.value, price=220,
            ))
            db.add(Appointment(
                patient_id=None, doctor_id=doctor_ids[0], clinic_id=clinic.clinic_id,
                appointment_datetime=base.replace(hour=18) + timedelta(days=day),
                appointment_status=AppointmentStatus.FREE.value,
                appointment_type=AppointmentType.ONLINE.value, price=150,
            ))

    # jedna potwierdzona wizyta pacjentki (jutro 9:00 u Kowalczyk)
    has_visit = db.scalar(select(Appointment).where(Appointment.patient_id == pat_u.user_id).limit(1))
    if has_visit is None:
        db.add(Appointment(
            patient_id=pat_u.user_id,
            doctor_id=doctor_ids[0],
            clinic_id=clinic.clinic_id,
            appointment_datetime=(datetime.now() + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0),
            appointment_status=AppointmentStatus.CONFIRMED.value,
            appointment_type=AppointmentType.STATIONARY.value,
        ))

    db.commit()
    demo_pack(db, clinic, doctor_ids, nurse_u.user_id, pat_u)
    print(f"Seed OK — klinika #{clinic.clinic_id}, lekarze: {len(doctor_ids)}, nowe sloty: {created_slots}")
    db.close()


DEMO_SHARE_CODE = "DEM-234"  # znacznik pakietu demo + kod do testu „Kod od pacjenta"


def demo_pack(db, clinic, doctor_ids: list[int], nurse_id: int, janina: AppUser) -> None:
    """Pakiet danych demo: na KAŻDYM koncie demo da się przetestować wszystko.

    - Lekarka: wizyty DZIŚ (zakończona / za 2h / teleporada za 3h) + kod DEM-234
    - Pacjentka: zakończone wizyty (oceny), dokumenty każdego typu (PDF),
      teleporada do wejścia, aktywne udostępnienie
    - Pielęgniarka: zabieg zaplanowany dziś + skierowanie czekające w kolejce
    - Rejestracja: pacjenci przypisani do placówki, dane do raportu, wpis
      na liście oczekujących (dodanie slotów Kardiologa → powiadomienie)
    """
    if db.scalar(select(DocumentShare).where(DocumentShare.access_code == DEMO_SHARE_CODE)):
        print("Pakiet demo już obecny — pomijam.")
        return

    kow = doctor_ids[0]  # dr Kowalczyk
    now = datetime.now().replace(minute=0, second=0, microsecond=0)

    # drugi pacjent demo
    stan = get_or_create_user(db, "stan.gorski@novamed.dev", "Stanisław Górski", "pacjent")
    if db.get(Patient, stan.user_id) is None:
        db.add(Patient(
            patient_id=stan.user_id, first_name="Stanisław", last_name="Górski",
            pesel="48092367890", birth_date=date(1948, 9, 23), insurance_status=True,
        ))

    # przypisanie pacjentów do placówki (lista w Panelu Poradni)
    for pid in (janina.user_id, stan.user_id):
        if not db.scalar(select(PatientClinic).where(
            PatientClinic.clinic_id == clinic.clinic_id, PatientClinic.patient_id == pid,
        )):
            db.add(PatientClinic(clinic_id=clinic.clinic_id, patient_id=pid, assigned_date=date.today()))

    def visit(patient_id, dt, status_, type_=AppointmentType.STATIONARY, reminder=True):
        a = Appointment(
            patient_id=patient_id, doctor_id=kow, clinic_id=clinic.clinic_id,
            appointment_datetime=dt, appointment_status=status_.value,
            appointment_type=type_.value, reminder_sent=reminder,
        )
        db.add(a)
        db.flush()
        return a

    # dzień lekarki DZIŚ + materiał na ocenę/raport/telewizytę.
    # Nadchodzące wizyty nie mogą przeskoczyć za północ (seed odpalany wieczorem)
    # — wtedy lądują jutro o sensownych godzinach.
    upcoming_1 = now + timedelta(hours=2)
    upcoming_2 = now + timedelta(hours=3)
    if upcoming_2.date() != now.date():
        upcoming_1 = (now + timedelta(days=1)).replace(hour=9)
        upcoming_2 = (now + timedelta(days=1)).replace(hour=10)
    v_done_today = visit(janina.user_id, now - timedelta(hours=2), AppointmentStatus.COMPLETED)
    visit(stan.user_id, upcoming_1, AppointmentStatus.CONFIRMED, reminder=False)
    visit(janina.user_id, upcoming_2, AppointmentStatus.CONFIRMED, AppointmentType.ONLINE, reminder=False)
    v_old = visit(janina.user_id, (now - timedelta(days=7)).replace(hour=10), AppointmentStatus.COMPLETED)

    def doc(appointment, dtype, dstatus, content=None):
        d = MedicalDocument(
            appointment_id=appointment.appointment_id, patient_id=appointment.patient_id,
            doctor_id=kow, issued_at=appointment.appointment_datetime,
            document_type=dtype, document_content=content, document_status=dstatus,
        )
        db.add(d)
        db.flush()
        return d

    # komplet typów dokumentów u Janiny (testy PDF/filtrów/kodu dostępu)
    d_rx = doc(v_old, "PRESCRIPTION", "CONFIRMED")
    db.add(Prescription(document_id=d_rx.document_id, prescription_code="4521",
                        prescribed_drugs="Amlodypina Bluefish 5 mg ×30 tabl. — D.S. 1×1 rano"))
    d_lab = doc(v_old, "LAB_RESULT", "READY")
    db.add(LabResult(document_id=d_lab.document_id, test_type="Lipidogram",
                     test_description="Cholesterol całk. 228 mg/dl • LDL 142 mg/dl • HDL 58 mg/dl • TG 140 mg/dl"))
    d_zla = doc(v_old, "SICK_LEAVE", "SENT")
    db.add(SickLeave(document_id=d_zla.document_id, sick_leave_code="ZLA-2026-0001",
                     start_date=(now - timedelta(days=7)).date(), end_date=(now - timedelta(days=1)).date(),
                     sent_to_zus=True))
    doc(v_old, "NOTE", "FINAL",
        content="RR 138/88, tony serca czyste. Kontynuacja leczenia, kontrola za 6 tygodni.")

    # pielęgniarka: zabieg zaplanowany DZIŚ (+1h) i skierowanie czekające w kolejce
    d_ref1 = doc(v_done_today, "REFERRAL", "ACTIVE", content='{"referral_type": "NURSING"}')
    ref1 = Referral(document_id=d_ref1.document_id, referral_code="NUR-DEMO1",
                    referral_type="NURSING", notes="Iniekcje domięśniowe wit. B12 — 1×dz. przez 10 dni")
    db.add(ref1)
    db.flush()
    db.add(NursingProcedure(
        nurse_id=nurse_id, patient_id=janina.user_id, clinic_id=clinic.clinic_id,
        appointment_id=v_done_today.appointment_id, referral_id=ref1.referral_id,
        procedure_type="Iniekcje domięśniowe wit. B12", procedure_status="PLANNED",
        procedure_datetime=now + timedelta(hours=1),
    ))
    d_ref2 = doc(v_done_today, "REFERRAL", "ACTIVE", content='{"referral_type": "NURSING"}')
    db.add(Referral(document_id=d_ref2.document_id, referral_code="NUR-DEMO2",
                    referral_type="NURSING", notes="Zmiana opatrunku podudzia — co 2 dni"))

    # aktywne udostępnienie Janiny (test „Kod od pacjenta" bez przelogowywania)
    db.add(DocumentShare(
        patient_id=janina.user_id, access_code=DEMO_SHARE_CODE,
        scope="ALL", expires_at=now + timedelta(days=30),
    ))

    # lista oczekujących: Stanisław czeka na Kardiologa — dodanie slotów
    # Kardiologa w Panelu Poradni wyśle mu powiadomienie
    if not db.scalar(select(WaitingListEntry).where(WaitingListEntry.patient_id == stan.user_id)):
        db.add(WaitingListEntry(patient_id=stan.user_id, specialization="Kardiolog"))

    db.commit()
    print(f"Pakiet demo dodany (kod udostępnienia: {DEMO_SHARE_CODE}).")


if __name__ == "__main__":
    main()
