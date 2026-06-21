"""Wysyła po jednym przykładowym e-mailu dla KAŻDEGO wariantu powiadomienia w systemie
(treści 1:1 z notify() w kodzie). W dev wszystko ląduje na EMAIL_REDIRECT_TO.
Wariant zakodowany w adresie odbiorcy → widać go w nagłówku „[do …]" z redirectu.

Uruchom z katalogu backend:  .\.venv\Scripts\python.exe scripts\send-email-samples.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/ na ścieżkę

from app.core.config import settings  # noqa: E402
from app.integrations.email import get_email_client  # noqa: E402

base = settings.public_base_url.rstrip("/")
L = f"{base}/potwierdz/Ab12Cd34EXAMPLE"
LT = f"{base}/teleporada/8f3a-EXAMPLE?vt=Ab12Cd34EXAMPLE"
V = "Konsultacja kardiologiczna (prywatnie), pon. 6 lipca 2026, 12:00, Zdrowa Rodzina — Piastów"
Vn = "Konsultacja kardiologiczna (NFZ), pon. 6 lipca 2026, 12:00, Zdrowa Rodzina — Piastów"
Vt = "Konsultacja internistyczna (prywatnie), pon. 6 lipca 2026, 14:00 — teleporada (wideo)"

SAMPLES = [
    ("przypomnienie-wczesniejszy-termin", "Zwolnił się wcześniejszy termin",
     "U dr Anna Kowalczyk zwolnił się termin 06.07.2026 12:00 i 1 kolejnych — wcześniej niż Twoja "
     "wizyta (20.07 09:00). Jeśli Ci pasuje, wejdź w Moje wizyty → Zmień termin (do 24 h przed wizytą, terminy bezpłatne)."),
    ("lista-oczekujacych-wolny", "Wolny termin — koniec oczekiwania",
     "Zwolnił się termin: Kardiolog. Zarezerwuj go w zakładce „Umów wizytę”."),
    ("lista-oczekujacych-nowe", "Nowe terminy — koniec oczekiwania",
     "Pojawiły się nowe terminy: Kardiolog. Zarezerwuj wizytę w zakładce „Umów wizytę”."),
    ("pacjent-nfz", "Wizyta potwierdzona", f"Twoja wizyta: {Vn}. Przypomnimy Ci o niej dzień wcześniej."),
    ("pacjent-na-miejscu", "Wizyta potwierdzona", f"Twoja wizyta: {V}. Opłata 200.00 zł do uregulowania na miejscu w placówce."),
    ("recepcja-zarejestrowala", "Wizyta potwierdzona", f"Zarejestrowaliśmy Twoją wizytę: {Vn}. Przypomnimy Ci o niej dzień wcześniej."),
    ("gosc-na-miejscu", "Wizyta potwierdzona", f"Twoja rezerwacja: {V}. Opłata 200.00 zł na miejscu. Zarządzaj wizytą (przełóż/odwołaj): {L}"),
    ("gosc-nfz", "Wizyta potwierdzona", f"Twoja rezerwacja: {Vn}. Zarządzaj wizytą (przełóż/odwołaj): {L}"),
    ("pacjent-oplacona", "Wizyta opłacona i potwierdzona", f"Płatność 200.00 zł zaksięgowana. Wizyta: {V}."),
    ("gosc-oplacona-stacjonarna", "Wizyta opłacona i potwierdzona", f"Płatność 200.00 zł zaksięgowana. Wizyta: {V}. Zarządzaj wizytą (przełóż/odwołaj): {L}"),
    ("gosc-oplacona-teleporada", "Wizyta opłacona i potwierdzona", f"Płatność 180.00 zł zaksięgowana. Wizyta: {Vt}. Dołącz do teleporady (wideo) z tego linku o wyznaczonej godzinie: {LT}"),
    ("pacjent-platnosc-odrzucona", "Płatność odrzucona", "Operator odrzucił płatność, ale termin jest nadal dla Ciebie zarezerwowany — spróbuj zapłacić ponownie do końca okna blokady."),
    ("gosc-platnosc-odrzucona", "Płatność odrzucona", "Operator odrzucił płatność, ale termin jest nadal zarezerwowany — spróbuj zapłacić ponownie z linku do końca okna blokady."),
    ("pacjent-odwolana-zwrot", "Wizyta odwołana", f"Wizyta {V} została odwołana. Zwrot 200 zł nastąpi tą samą metodą płatności."),
    ("gosc-odwolal-sam", "Wizyta odwołana", f"Odwołałeś wizytę: {V}. Zwrot opłaty nastąpi tą samą metodą."),
    ("przelozona", "Wizyta przełożona", f"Nowy termin Twojej wizyty: {V}."),
    ("przypomnienie-potwierdz-batch", "Przypomnienie: potwierdź wizytę", f"Wizyta: dr Anna Kowalczyk, 06.07.2026 12:00. Potwierdź lub odwołaj jednym kliknięciem: {L}"),
    ("przypomnienie-dzien-przed", "Przypomnienie o wizycie", "Jutro masz wizytę: dr Anna Kowalczyk, 06.07.2026 12:00."),
    ("przypomnienie-dzien-przed-teleporada", "Przypomnienie o wizycie", "Jutro masz wizytę: dr Piotr Zieliński, 06.07.2026 14:00 (teleporada — połączysz się z portalu)."),
    ("reminders-potwierdz", "Potwierdź swoją wizytę", f"Wizyta: dr Anna Kowalczyk, 06.07.2026 12:00 (Zdrowa Rodzina — Piastów). Potwierdź lub odwołaj jednym kliknięciem: {L}"),
    ("rezerwacja-wygasla", "Rezerwacja wygasła", f"Płatność za wizytę ({V}) nie została dokończona w 10 min — termin wrócił do puli. Jeśli nadal chcesz, zarezerwuj go ponownie."),
    ("nowy-dokument-erecepta", "Nowy dokument: e-recepta", "W Twojej dokumentacji pojawił się nowy dokument (e-recepta). Kod: 4821."),
    ("dokument-anulowany", "Dokument anulowany", "Twój dokument (e-recepta) został anulowany przez lekarza. Powód: błędna dawka."),
    ("nowy-wynik-pacjent", "Nowy wynik badania", "Wynik badania (morfologia krwi) jest już dostępny w Twojej dokumentacji."),
    ("wynik-do-opisania-lekarz", "Wynik badania do opisania", "Dotarł wynik (morfologia krwi) — Marek Testowy. Sprawdź w zakładce Dokumenty."),
    ("podopieczny-przyklad", "Wizyta potwierdzona", f"[Zosia Testowa] Twoja wizyta: {Vn}. Przypomnimy Ci o niej dzień wcześniej."),
]


def main() -> None:
    c = get_email_client()
    for i, (label, title, body) in enumerate(SAMPLES, 1):
        c.send(to=f"{label}@wariant.demo", subject=f"NovaMed: {title}", body=body)
        print(f"{i:2d}. [{label}] NovaMed: {title}")
    print(f"--- wyslano {len(SAMPLES)} przykladowych maili ---")


if __name__ == "__main__":
    main()
