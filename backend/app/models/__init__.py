# Import wszystkich modeli, żeby Base.metadata widziało pełny schemat (Alembic autogenerate).
from app.models.user import Role, AppUser, Administrator, Doctor, Nurse, Patient
from app.models.clinic import Clinic, PatientClinic, StaffClinic
from app.models.appointment import Appointment
from app.models.document import MedicalDocument, Prescription, Referral, LabResult, SickLeave
from app.models.nursing import NursingProcedure
from app.models.review import Review
from app.models.notification import Notification

__all__ = [
    "Role", "AppUser", "Administrator", "Doctor", "Nurse", "Patient",
    "Clinic", "PatientClinic", "StaffClinic",
    "Appointment",
    "MedicalDocument", "Prescription", "Referral", "LabResult", "SickLeave",
    "NursingProcedure", "Review", "Notification",
]
