# Cykl życia wizyty — implementacja diagramu stanów
# diagram stanów wizyty. Każda zmiana statusu przechodzi
# przez assert_transition(); przejścia spoza mapy = błąd 409.
from enum import Enum

from fastapi import HTTPException, status


class AppointmentStatus(str, Enum):
    FREE = "FREE"                  # Wolna — termin w kalendarzu, patient_id IS NULL
    TEMP_LOCK = "TEMP_LOCK"        # BlokadaTymczasowa — na czas płatności
    CONFIRMED = "CONFIRMED"        # Potwierdzona
    IN_PROGRESS = "IN_PROGRESS"    # WTrakcie
    COMPLETED = "COMPLETED"        # Zakończona
    CANCELLED = "CANCELLED"        # Odwołana
    NO_SHOW = "NO_SHOW"            # NieOdbyta
    INTERRUPTED = "INTERRUPTED"    # Przerwana


class AppointmentType(str, Enum):
    STATIONARY = "STATIONARY"
    ONLINE = "ONLINE"


ALLOWED_TRANSITIONS: dict[AppointmentStatus, set[AppointmentStatus]] = {
    AppointmentStatus.FREE: {AppointmentStatus.TEMP_LOCK, AppointmentStatus.CONFIRMED},
    AppointmentStatus.TEMP_LOCK: {AppointmentStatus.FREE, AppointmentStatus.CONFIRMED},
    AppointmentStatus.CONFIRMED: {
        AppointmentStatus.IN_PROGRESS,
        AppointmentStatus.CANCELLED,
        AppointmentStatus.NO_SHOW,
    },
    AppointmentStatus.IN_PROGRESS: {AppointmentStatus.COMPLETED, AppointmentStatus.INTERRUPTED},
    # stany końcowe — brak wyjść (Odwołana "wraca do puli" przez NOWY wolny slot,
    # nie przez zmianę statusu odwołanej wizyty; historia zostaje)
    AppointmentStatus.COMPLETED: set(),
    AppointmentStatus.CANCELLED: set(),
    AppointmentStatus.NO_SHOW: set(),
    AppointmentStatus.INTERRUPTED: set(),
}

# Polityka placówki (UC-P10): bezpłatne odwołanie/przełożenie najpóźniej 24 h przed wizytą
CANCEL_MIN_HOURS = 24


def assert_transition(current: str, new: AppointmentStatus) -> None:
    cur = AppointmentStatus(current)
    if new not in ALLOWED_TRANSITIONS[cur]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Niedozwolona zmiana statusu wizyty: {cur.value} → {new.value}.",
        )
