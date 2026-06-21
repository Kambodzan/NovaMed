"""Wysyła po jednym przykładowym e-mailu dla KAŻDEGO wariantu powiadomienia.

Treści bierze WPROST z `app.domain.messages` (ten sam kod, co prawdziwe maile —
próbki nie mogą się rozjechać z produkcją). Linki „zarządzaj wizytą"/teleporada
wskazują na REALNE wizyty z bazy (token przez ensure_confirm_token), więc działają.
W dev wszystko ląduje na EMAIL_REDIRECT_TO; wariant zakodowany w adresie odbiorcy
→ widać go w nagłówku „[do …]" z redirectu.

Uruchom z katalogu backend:  .\.venv\Scripts\python.exe scripts\send-email-samples.py
"""
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/ na ścieżkę

from sqlalchemy import select  # noqa: E402

from app.api.appointments import visit_label  # noqa: E402
from app.core.db import SessionLocal  # noqa: E402
from app.domain import messages  # noqa: E402
from app.domain.confirm import confirm_link, ensure_confirm_token  # noqa: E402
from app.integrations.email import get_email_client  # noqa: E402
from app.models import Appointment  # noqa: E402

DT = datetime(2026, 7, 6, 12, 0)


def _real_visit(db, *, online: bool):
    """Znajduje potwierdzoną wizytę (stacjonarną/teleporadę) i zwraca (label, link).
    Dzięki temu link w mailu prowadzi do żywej wizyty. Gdy brak — None."""
    a = db.scalar(
        select(Appointment)
        .where(Appointment.appointment_status == "CONFIRMED",
               Appointment.patient_id.is_not(None),
               (Appointment.appointment_type == "ONLINE") if online else (Appointment.appointment_type != "ONLINE"))
        .order_by(Appointment.appointment_datetime.desc())
    )
    if a is None:
        return None
    return visit_label(db, a), confirm_link(ensure_confirm_token(a))


def build_samples(db):
    stat = _real_visit(db, online=False)
    tele = _real_visit(db, online=True)
    db.commit()  # ensure_confirm_token mógł nadać token
    # fallbacki, gdy w bazie nie ma jeszcze potwierdzonych wizyt
    s_label, s_link = stat or ("Konsultacja kardiologiczna (prywatnie), pon. 6 lipca 2026, 12:00, Zdrowa Rodzina — Piastów", "https://example/potwierdz/BRAK-WIZYTY")
    t_label, t_link = tele or ("Konsultacja internistyczna (prywatnie), pon. 6 lipca 2026, 14:00 — teleporada (wideo)", "https://example/potwierdz/BRAK-WIZYTY")

    # TYLKO zdarzenia z whitelisty e-mail (reszta zostaje w aplikacji/SMS).
    # (label_odbiorcy, (title, body)); treści z messages.* — zero driftu z produkcją.
    return [
        # --- potwierdzenia (co/gdzie/kiedy; link tylko: teleporada albo gość-bez-konta) ---
        ("potwierdzona-zalogowany", messages.visit_confirmed(s_label)),                       # bez linka (zarządza w aplikacji)
        ("potwierdzona-gosc", messages.visit_confirmed(s_label, manage_link=s_link)),         # gość → link do zarządzania
        ("potwierdzona-na-miejscu", messages.visit_confirmed(s_label, on_site_amount=200.0)),
        ("oplacona-teleporada", messages.visit_paid_confirmed(t_label, 180.0, join_link=t_link)),  # link do wideo
        ("oplacona-gosc-stacjonarna", messages.visit_paid_confirmed(s_label, 200.0, manage_link=s_link)),
        # --- zmiany wizyty ---
        ("przelozona", messages.visit_rescheduled(s_label)),
        ("odwolana-ze-zwrotem", messages.visit_cancelled(s_label, refunded=True)),
        # --- przypomnienia (link tylko dla teleporady) ---
        ("przypomnienie", messages.visit_reminder("dr Anna Kowalczyk", DT)),
        ("przypomnienie-teleporada", messages.visit_reminder("dr Piotr Zieliński", DT.replace(hour=14), join_link=t_link)),
        # --- coś nowego/ważnego wpada na konto ---
        ("nowy-dokument", ("Nowy dokument: e-recepta", "W Twojej dokumentacji pojawił się nowy dokument (e-recepta). Kod: 4821.")),
        ("nowy-wynik", ("Nowy wynik badania", "Wynik badania (morfologia krwi) jest już dostępny w Twojej dokumentacji.")),
        # --- konto rodzinne: powiadomienie podopiecznego (prefiks trafia do opiekuna) ---
        ("podopieczny", (messages.visit_confirmed(s_label)[0], f"[Zosia Testowa] {messages.visit_confirmed(s_label)[1]}")),
    ]


def main() -> None:
    db = SessionLocal()
    try:
        samples = build_samples(db)
    finally:
        db.close()
    c = get_email_client()
    for i, (label, (title, body)) in enumerate(samples, 1):
        c.send(to=f"{label}@wariant.demo", subject=f"NovaMed: {title}", body=body)
        print(f"{i:2d}. [{label}] NovaMed: {title}")
    print(f"--- wyslano {len(samples)} przykladowych maili ---")


if __name__ == "__main__":
    main()
