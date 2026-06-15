# Typy i statusy dokumentów medycznych.
# E-recepta: diagram stanów e-recepty (DRAFT→SENT_TO_P1→CONFIRMED→REALIZED, ERROR→retry).
from enum import Enum


class DocumentType(str, Enum):
    PRESCRIPTION = "PRESCRIPTION"
    REFERRAL = "REFERRAL"
    LAB_RESULT = "LAB_RESULT"
    SICK_LEAVE = "SICK_LEAVE"
    NOTE = "NOTE"
    CERTIFICATE = "CERTIFICATE"   # zaświadczenie lekarskie (lokalne, nie P1/ZUS)


class DocumentStatus(str, Enum):
    DRAFT = "DRAFT"
    SENT_TO_P1 = "SENT_TO_P1"
    CONFIRMED = "CONFIRMED"
    REALIZED = "REALIZED"
    ERROR = "ERROR"          # odrzucone/błąd komunikacji — można wysłać ponownie
    ACTIVE = "ACTIVE"        # skierowania wewnętrzne (zabiegi pielęgniarskie)
    SENT = "SENT"            # e-ZLA przyjęte przez ZUS
    READY = "READY"          # wynik badania dostępny
    RECEIVED_BY_DOCTOR = "RECEIVED_BY_DOCTOR"  # lekarz zapoznał się z wynikiem
    FINAL = "FINAL"          # notatka z wizyty
    REVOKED = "REVOKED"      # anulowany przez lekarza (storno) — także w P1/ZUS


class ReferralType(str, Enum):
    """Skierowania: do P1 idą LAB i SPECIALIST; NURSING jest wewnętrzne
    (UC-L4 — trafia wprost do Portalu Pielęgniarki, bez systemu centralnego)."""

    LAB = "LAB"
    SPECIALIST = "SPECIALIST"
    NURSING = "NURSING"
