"""Ujednolicone szablony powiadomień (UC-P7) — JEDNA treść na zdarzenie.

Wcześniej te same zdarzenia (potwierdzenie wizyty, opłacenie, odwołanie, prośba
o potwierdzenie) miały po kilka wariantów rozsianych po `appointments.py`,
`public.py` i `reminders.py`. Tu jest jeden standard, a kanały (in-app/SMS/e-mail)
bierze `notify()`.

Zasada treści maila/SMS: to INFORMACJA (co/gdzie/kiedy), bez linków zarządzania.
Jedyny dopuszczony link to dostęp do teleporady (`join_link`) — bo bez niego
gość/pacjent nie ma jak wejść na wideo. Prośba o potwierdzenie obecności trzyma
swój link, ale ona nie idzie mailem (tylko in-app + SMS).

Funkcje są czyste (string in/out); call-site liczy `label`/`join_link` istniejącymi
helperami. Każda zwraca `(title, content)` — wprost do `notify(db, uid, *...)`.
"""
from datetime import datetime


def _dt(dt: datetime) -> str:
    return dt.strftime("%d.%m.%Y %H:%M")


def _link(body: str, join_link: str | None, manage_link: str | None = None) -> str:
    """Dokleja JEDEN link, gdy potrzebny: teleporada (online) albo zarządzanie
    (gość bez konta). Zalogowany pacjent stacjonarnie → bez linka. Logikę „kiedy"
    rozstrzyga `confirm.audience_links`; tu tylko frazujemy."""
    if join_link:
        body += f" Dołącz do teleporady (wideo) z tego linku o wyznaczonej godzinie: {join_link}"
    elif manage_link:
        body += f" Zarządzaj wizytą (przełóż/odwołaj): {manage_link}"
    return body


def visit_confirmed(label: str, *, join_link: str | None = None, manage_link: str | None = None,
                    on_site_amount: float | None = None) -> tuple[str, str]:
    """Wizyta potwierdzona (NFZ, płatność na miejscu, gość, rejestracja przez recepcję)."""
    body = f"Twoja wizyta: {label}. "
    if on_site_amount is not None:
        body += f"Opłata {on_site_amount:.2f} zł do uregulowania na miejscu w placówce. "
    body += "Przypomnimy Ci o niej dzień wcześniej."
    return "Wizyta potwierdzona", _link(body, join_link, manage_link)


def visit_paid_confirmed(label: str, amount: float, *, join_link: str | None = None,
                         manage_link: str | None = None) -> tuple[str, str]:
    """Wizyta opłacona online i potwierdzona (pacjent i gość)."""
    return "Wizyta opłacona i potwierdzona", _link(
        f"Płatność {amount:.2f} zł zaksięgowana. Wizyta: {label}.", join_link, manage_link)


def visit_rescheduled(label: str, *, join_link: str | None = None, manage_link: str | None = None) -> tuple[str, str]:
    """Wizyta przełożona na nowy termin (co/gdzie/kiedy)."""
    return "Wizyta przełożona", _link(f"Nowy termin Twojej wizyty: {label}.", join_link, manage_link)


def visit_cancelled(label: str, *, refunded: bool) -> tuple[str, str]:
    """Wizyta odwołana (przez pacjenta/gościa/placówkę) — opcjonalnie ze zwrotem."""
    body = f"Wizyta {label} została odwołana."
    if refunded:
        body += " Zwrot opłaty nastąpi tą samą metodą płatności."
    return "Wizyta odwołana", body


def visit_reminder(who: str, dt: datetime, *, join_link: str | None = None) -> tuple[str, str]:
    """Przypomnienie dzień przed wizytą (informacyjne; link tylko do teleporady)."""
    return "Przypomnienie o wizycie", _link(f"Jutro masz wizytę: {who}, {_dt(dt)}.", join_link)


def teleporada_soon(who: str, dt: datetime, *, join_link: str | None, minutes: int) -> tuple[str, str]:
    """Przypomnienie TUŻ PRZED teleporadą — z linkiem do dołączenia od razu (UC-P7).
    Osobne od 24h: link trafia, gdy jest najbardziej potrzebny, a nie dobę wcześniej."""
    body = f"Twoja teleporada ({who}) zaczyna się o {dt.strftime('%H:%M')} — za ok. {minutes} min."
    if join_link:
        body += f" Dołącz (wideo): {join_link}"
    return "Teleporada za chwilę", body


def payment_declined() -> tuple[str, str]:
    """Bramka odrzuciła płatność — termin nadal trzymany, można ponowić. (Nie mailem.)"""
    return ("Płatność odrzucona",
            "Operator odrzucił płatność, ale termin jest nadal dla Ciebie zarezerwowany "
            "— spróbuj zapłacić ponownie do końca okna blokady.")


def confirm_request(who: str, dt: datetime, *, link: str, clinic_name: str | None = None) -> tuple[str, str]:
    """Prośba o potwierdzenie obecności (in-app + SMS; nie mailem) — z linkiem akcji."""
    where = f" ({clinic_name})" if clinic_name else ""
    return ("Potwierdź swoją wizytę",
            f"Wizyta: {who}, {_dt(dt)}{where}. Potwierdź lub odwołaj jednym kliknięciem: {link}")


def reservation_expired(label: str, minutes: int) -> tuple[str, str]:
    """Porzucona płatność — TEMP_LOCK wygasł, termin wrócił do puli. (Nie mailem.)"""
    return ("Rezerwacja wygasła",
            f"Płatność za wizytę ({label}) nie została dokończona w {minutes} min "
            "— termin wrócił do puli. Jeśli nadal chcesz, zarezerwuj go ponownie.")
