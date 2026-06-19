# Weryfikacja e-skierowania z P1 przy rezerwacji (NFZ u specjalisty/na badanie).
# Pacjent okazuje KOD skierowania (wystawionego np. przez lekarza rodzinnego,
# widocznego w P1); sprawdzamy je przez port P1 (mock-first) i — jeśli pasuje do
# specjalizacji wybranego lekarza / typu badania — realizujemy (jednorazowo).
#
from fastapi import HTTPException, status

from app.integrations.base import IntegrationError
from app.integrations.p1 import P1Client


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def verify_p1_referral(p1: P1Client, code: str, *, pesel: str, targets: list[str]) -> dict:
    """Sprawdza e-skierowanie z P1 po kodzie: istnieje, jest skierowaniem, na ten
    PESEL, nie anulowane, niewykorzystane i pasuje do którejś z docelowych
    specjalizacji/typów (`targets` = specjalizacje lekarza albo nazwa badania).
    Zwraca dokument; rzuca 409 przy niezgodności. NIE realizuje (to robi consume)."""
    try:
        doc = p1.verify_referral(code=code)
    except IntegrationError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=exc.message) from exc
    if doc is None:
        raise _conflict("Nie znaleziono e-skierowania o tym kodzie w P1 — sprawdź kod.")
    if doc.get("type") != "referral":
        raise _conflict("Podany kod nie jest e-skierowaniem.")
    if doc.get("revoked"):
        raise _conflict("To e-skierowanie zostało anulowane.")
    if doc.get("used"):
        raise _conflict("To e-skierowanie zostało już wykorzystane.")
    if doc.get("pesel") and pesel and doc["pesel"] != pesel:
        raise _conflict("To e-skierowanie jest wystawione na inny PESEL.")
    target = (doc.get("specialization") or "").strip().lower()
    pool = [t.strip().lower() for t in targets if t]
    if target and not any(target == x or target in x or x in target for x in pool):
        spec = doc.get("specialization")
        raise _conflict(
            f"E-skierowanie dotyczy innej poradni ({spec}) niż wybrany termin "
            "— umów się zgodnie ze skierowaniem.")
    return doc


def consume_p1_referral(p1: P1Client, code: str) -> None:
    """Realizuje skierowanie w P1 (oznacza wykorzystane). Awaria P1 = 502."""
    try:
        p1.consume_referral(code=code)
    except IntegrationError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=exc.message) from exc
