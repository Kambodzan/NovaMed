"""Ujednolicone szablony powiadomień (UC-P7) — JEDNA treść na zdarzenie.

Wcześniej te same zdarzenia (potwierdzenie wizyty, opłacenie, odwołanie, prośba
o potwierdzenie) miały po kilka wariantów rozsianych po `appointments.py`,
`public.py` i `reminders.py` — pacjent dostawał inną treść niż gość, część bez
linka do zarządzania. Tu jest jeden standard, a kanały (in-app/SMS/e-mail) bierze
`notify()`. Funkcje są czyste (string in/out) — nie znają DB; call-site liczy
`label`/`link` istniejącymi helperami (`visit_label`, `confirm_link`).

Każda funkcja zwraca `(title, content)` — podawane wprost do `notify(db, uid, *...)`.
"""
from datetime import datetime


def _dt(dt: datetime) -> str:
    return dt.strftime("%d.%m.%Y %H:%M")


def visit_confirmed(label: str, *, manage_link: str, on_site_amount: float | None = None) -> tuple[str, str]:
    """Wizyta potwierdzona (NFZ, płatność na miejscu, gość, rejestracja przez recepcję)."""
    body = f"Twoja wizyta: {label}. "
    if on_site_amount is not None:
        body += f"Opłata {on_site_amount:.2f} zł do uregulowania na miejscu w placówce. "
    body += f"Przypomnimy Ci o niej dzień wcześniej. Zarządzaj wizytą (przełóż/odwołaj): {manage_link}"
    return "Wizyta potwierdzona", body


def visit_paid_confirmed(label: str, amount: float, *, link: str, online: bool) -> tuple[str, str]:
    """Wizyta opłacona online i potwierdzona (pacjent i gość)."""
    tail = (f"Dołącz do teleporady (wideo) z tego linku o wyznaczonej godzinie: {link}"
            if online else f"Zarządzaj wizytą (przełóż/odwołaj): {link}")
    return "Wizyta opłacona i potwierdzona", f"Płatność {amount:.2f} zł zaksięgowana. Wizyta: {label}. {tail}"


def payment_declined() -> tuple[str, str]:
    """Bramka odrzuciła płatność — termin nadal trzymany, można ponowić."""
    return ("Płatność odrzucona",
            "Operator odrzucił płatność, ale termin jest nadal dla Ciebie zarezerwowany "
            "— spróbuj zapłacić ponownie do końca okna blokady.")


def visit_cancelled(label: str, *, refunded: bool) -> tuple[str, str]:
    """Wizyta odwołana (przez pacjenta/gościa/placówkę) — opcjonalnie ze zwrotem."""
    body = f"Wizyta {label} została odwołana."
    if refunded:
        body += " Zwrot opłaty nastąpi tą samą metodą płatności."
    return "Wizyta odwołana", body


def visit_rescheduled(label: str) -> tuple[str, str]:
    """Wizyta przełożona na nowy termin."""
    return "Wizyta przełożona", f"Nowy termin Twojej wizyty: {label}."


def confirm_request(who: str, dt: datetime, *, link: str, clinic_name: str | None = None) -> tuple[str, str]:
    """Prośba o potwierdzenie obecności (jeden standard dla cronu i ręcznego batcha)."""
    where = f" ({clinic_name})" if clinic_name else ""
    return ("Potwierdź swoją wizytę",
            f"Wizyta: {who}, {_dt(dt)}{where}. Potwierdź lub odwołaj jednym kliknięciem: {link}")


def visit_reminder(who: str, dt: datetime, *, online: bool) -> tuple[str, str]:
    """Przypomnienie dzień przed wizytą (informacyjne)."""
    extra = " (teleporada — połączysz się z portalu)" if online else ""
    return "Przypomnienie o wizycie", f"Jutro masz wizytę: {who}, {_dt(dt)}{extra}."


def reservation_expired(label: str, minutes: int) -> tuple[str, str]:
    """Porzucona płatność — TEMP_LOCK wygasł, termin wrócił do puli."""
    return ("Rezerwacja wygasła",
            f"Płatność za wizytę ({label}) nie została dokończona w {minutes} min "
            "— termin wrócił do puli. Jeśli nadal chcesz, zarezerwuj go ponownie.")
