# Generator przykładowych danych domenowych „do klikania" — przez API NA ŻYWO,
# tak jak robi to aplikacja (Supabase login + endpointy domenowe). Tworzy dla
# Janiny i Tomasza: dane kliniczne + eWUŚ, wizyty zakończone z notami i
# dokumentami (e-recepta/e-skierowanie/e-zwolnienie/wynik/zaświadczenie),
# opinie, nadchodzące wizyty oraz zabieg pielęgniarski. Szanuje izolację
# placówek (#25): pacjent umawiany u lekarza ze swojej placówki.
#
# Wizyty „zakończone" tworzy dziś (API blokuje rezerwacje wsteczne), a na końcu
# JEDNYM zapisem do bazy cofa ich datę (i datę dokumentów/not), żeby „Historia
# wizyt" wyglądała realnie (rozłożona w czasie). Sama treść jest prawdziwa —
# przesuwamy tylko znaczniki czasu.
#
# Wymaga działającego backendu (:8000) i mocków (eWUŚ:8103, P1:8101, ZUS:8102).
# Użycie:  cd backend; .venv\Scripts\python.exe ..\scripts\seed-demo-data.py
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import httpx  # noqa: E402

from app.core.config import settings  # noqa: E402

API = "https://127.0.0.1:8000"
ROOT = Path(__file__).resolve().parents[1]
ANON = next(
    line.split("=", 1)[1].strip()
    for line in (ROOT / "frontend" / ".env.development").read_text(encoding="utf-8").splitlines()
    if line.startswith("VITE_SUPABASE_ANON_KEY=")
)
PASSWORD = "NovaMed.Test1"
c = httpx.Client(verify=False, timeout=30)


def login(email: str) -> str:
    r = httpx.post(f"{settings.supabase_url}/auth/v1/token?grant_type=password",
                   headers={"apikey": ANON, "Content-Type": "application/json"},
                   json={"email": email, "password": PASSWORD}, timeout=30)
    r.raise_for_status()
    return r.json()["access_token"]


def H(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


def api(method: str, path: str, tok: str, **kw):
    r = c.request(method, f"{API}{path}", headers=H(tok), **kw)
    return r


def me_id(tok: str) -> str:
    return api("GET", "/auth/me", tok).json()["user_id"]


def next_grid_time(offset_min: int = 0) -> datetime:
    """Najbliższy wolny slot na siatce 15 min, dziś, bezpiecznie w przód."""
    base = datetime.now().replace(second=0, microsecond=0)
    add = (15 - base.minute % 15) % 15
    base = base + timedelta(minutes=(add or 15) + 15)
    return base + timedelta(minutes=offset_min)


# ---------------------------------------------------------------------------
print("Logowanie…")
reg = login("rejestracja@novamed.dev")
kow = login("a.kowalczyk@novamed.dev")   # Kardiolog — Piastów
ziel = login("p.zielinski@novamed.dev")  # Internista — Piastów + Ursus
lis = login("k.lis@novamed.dev")         # pielęgniarka — Piastów
jan = login("janina.wisniewska@novamed.dev")
tom = login("tomasz.borkowski@novamed.dev")
jan_id = me_id(jan)
tom_id = me_id(tom)

clinics = {x["clinic_name"]: x["clinic_id"] for x in api("GET", "/clinics", reg).json()}
piastow = next(v for k, v in clinics.items() if "Piastów" in k)
ursus = next(v for k, v in clinics.items() if "Ursus" in k)
docs = {d["name"]: d["doctor_id"] for d in api("GET", f"/clinics/{piastow}/doctors", reg).json()}
kow_id = next(v for k, v in docs.items() if "Kowalczyk" in k)
ziel_id = next(v for k, v in docs.items() if "Zieliński" in k)

# katalog usług (seed-services musi pójść WCZEŚNIEJ) — wizyty demo rezerwujemy na
# slotach USŁUGOWYCH, żeby niosły service_name (jak każda realna rezerwacja).
_svc_cache: dict[str, list] = {}


def svc(clinic_id: str, doctor_id: str, name_substr: str) -> str | None:
    """service_id usługi danego lekarza w placówce po fragmencie nazwy (None = brak)."""
    if clinic_id not in _svc_cache:
        _svc_cache[clinic_id] = api("GET", f"/clinics/{clinic_id}/services", reg).json()
    for s in _svc_cache[clinic_id]:
        if name_substr.lower() in s["name"].lower() and doctor_id in s.get("doctor_ids", []):
            return s["service_id"]
    return None


KARD = svc(piastow, kow_id, "Konsultacja kardiologiczna")       # Kowalczyk, Piastów
INTERN_P = svc(piastow, ziel_id, "Konsultacja internistyczna")  # Zieliński, Piastów
INTERN_U = svc(ursus, ziel_id, "Konsultacja internistyczna")    # Zieliński, Ursus
if not all((KARD, INTERN_P, INTERN_U)):
    print("  ! UWAGA: brak usług w katalogu — uruchom najpierw seed-services.py "
          "(wizyty demo będą generyczne, bez przekładania).")

# (appointment_id, dni_wstecz) — do cofnięcia daty na końcu
to_backdate: list[tuple[str, int]] = []
_slot_n = [0]


def make_slot(clinic_id: str, doctor_id: str, dt: datetime, **extra) -> str:
    r = api("POST", f"/clinics/{clinic_id}/slots", reg,
            json={"doctor_id": doctor_id, "datetimes": [dt.isoformat()], **extra})
    if r.status_code == 201:
        return r.json()[0]["appointment_id"]
    if r.status_code == 409:  # slot na ten czas już istnieje (np. z seed-services) — użyj go
        for s in api("GET", "/slots", reg, params={"doctor_id": doctor_id}).json():
            if s["appointment_datetime"][:16] == dt.isoformat()[:16]:
                return s["appointment_id"]
    r.raise_for_status()
    return r.json()[0]["appointment_id"]


def completed_visit(clinic_id: str, doctor_tok: str, doctor_id: str, patient_id: str,
                    days_ago: int, note: str, service_id: str | None = None) -> str:
    """Pełne flow zakończonej wizyty (dziś), z datą cofniętą na końcu."""
    dt = next_grid_time(_slot_n[0] * 15)
    _slot_n[0] += 1
    aid = make_slot(clinic_id, doctor_id, dt, **({"service_id": service_id} if service_id else {}))
    book = {"patient_id": patient_id, **({"external_referral": True} if service_id else {})}
    api("POST", f"/appointments/{aid}/book-for", reg, json=book).raise_for_status()
    api("POST", f"/appointments/{aid}/status", doctor_tok, json={"new_status": "IN_PROGRESS"}).raise_for_status()
    api("PUT", f"/appointments/{aid}/note", doctor_tok, json={"content": note}).raise_for_status()
    to_backdate.append((aid, days_ago))
    return aid  # dokumenty wystawiamy po; COMPLETED na końcu (autopodpis noty)


def finish(aid: str, doctor_tok: str) -> None:
    api("POST", f"/appointments/{aid}/status", doctor_tok, json={"new_status": "COMPLETED"}).raise_for_status()


def upcoming_visit(clinic_id: str, doctor_id: str, patient_id: str, days_ahead: int,
                   hour: int, online: bool = False, service_id: str | None = None) -> str:
    dt = (datetime.now() + timedelta(days=days_ahead)).replace(hour=hour, minute=0, second=0, microsecond=0)
    extra = {"appointment_type": "ONLINE"} if online else {}
    if service_id:
        extra["service_id"] = service_id
    aid = make_slot(clinic_id, doctor_id, dt, **extra)
    book = {"patient_id": patient_id, **({"external_referral": True} if service_id else {})}
    api("POST", f"/appointments/{aid}/book-for", reg, json=book).raise_for_status()
    return aid


def issue(path: str, tok: str, body: dict) -> dict | None:
    r = api("POST", path, tok, json=body)
    if r.status_code not in (200, 201):
        print(f"  ! {path}: {r.status_code} {r.text[:120]}")
        return None
    return r.json()


# --- dane kliniczne + ubezpieczenie -----------------------------------------
print("Dane kliniczne + eWUŚ…")
api("PATCH", f"/patients/{jan_id}/clinical", kow, json={
    "allergies": "Penicylina (wstrząs anafilaktyczny)",
    "chronic_diseases": "Nadciśnienie tętnicze, hipercholesterolemia",
    "chronic_medications": "Ramipril 5 mg rano",
})
for pid, tok in [(jan_id, kow), (tom_id, ziel)]:
    api("POST", f"/patients/{pid}/verify-insurance", tok)

# --- Janina: 2 wizyty zakończone (Kardiolog Kowalczyk, Piastów) --------------
print("Janina — wizyty, dokumenty, opinia…")
v1 = completed_visit(piastow, kow, kow_id, jan_id, days_ago=56, note=(
    "Wywiad: kołatania serca, epizody podwyższonego ciśnienia (do 160/95).\n"
    "Badanie: HR 78/min miarowy, RR 150/90, osłuchowo bez zmian.\n"
    "Rozpoznanie: I10 Nadciśnienie tętnicze pierwotne.\n"
    "Zalecenia: Ramipril 5 mg rano, kontrola RR w domu, dieta niskosodowa."))
issue(f"/patients/{jan_id}/prescriptions", kow, {"appointment_id": v1, "icd10": "I10", "drugs": "Ramipril 5 mg, 1 tabl. rano (30 tabl.)"})
issue(f"/patients/{jan_id}/referrals", kow, {"appointment_id": v1, "referral_type": "SPECIALIST", "icd10": "I10", "notes": "Konsultacja kardiologiczna + ECHO serca"})
finish(v1, kow)

v2 = completed_visit(piastow, kow, kow_id, jan_id, days_ago=21, note=(
    "Wywiad: kontrola po włączeniu Ramiprilu, RR w domu ~135/85, lepsza tolerancja wysiłku.\n"
    "Badanie: RR 138/86, HR 72/min.\n"
    "Rozpoznanie: I10 — nadciśnienie kontrolowane.\n"
    "Zalecenia: dołączyć Amlodypinę 5 mg, lipidogram kontrolnie."))
issue(f"/patients/{jan_id}/prescriptions", kow, {"appointment_id": v2, "icd10": "I10", "drugs": "Amlodypina 5 mg, 1 tabl. rano (30 tabl.)"})
nursing_ref = issue(f"/patients/{jan_id}/referrals", kow, {"appointment_id": v2, "referral_type": "NURSING", "icd10": "I10", "notes": "Pomiar RR i iniekcja — kontrola w gabinecie zabiegowym"})
issue(f"/patients/{jan_id}/lab-results", kow, {"appointment_id": v2, "test_type": "Lipidogram", "test_description": "Cholesterol całkowity, LDL, HDL, trójglicerydy"})
finish(v2, kow)

# opinia po wizycie v2
issue("/reviews", jan, {"appointment_id": v2, "doctor_rating": 5, "clinic_rating": 4,
                        "doctor_comment": "Pani doktor wszystko dokładnie wytłumaczyła, polecam.",
                        "clinic_comment": "Sprawna rejestracja, krótkie oczekiwanie."})

# zabieg pielęgniarski ze skierowania NURSING (portal pielęgniarki)
if nursing_ref:
    proc = issue("/procedures", lis, {"referral_document_id": nursing_ref["document_id"],
                                       "procedure_datetime": next_grid_time(90).isoformat()})
    if proc:
        api("POST", f"/procedures/{proc['procedure_id']}/complete", lis,
            json={"notes": "Pomiar RR 134/84, iniekcja wykonana bez powikłań."})

# nadchodzące wizyty Janiny (stacjonarna + teleporada) — usługowe, więc da się je przełożyć
upcoming_visit(piastow, kow_id, jan_id, days_ahead=6, hour=9, service_id=KARD)
upcoming_visit(piastow, kow_id, jan_id, days_ahead=20, hour=11, online=True, service_id=KARD)

# --- e-skierowania zewnętrzne w P1 (od „lekarza rodzinnego") — do rezerwacji NFZ
# u specjalisty kodem. Mock P1 trzyma je w pamięci; po jego
# restarcie odpal seed ponownie. Janina może umówić kardiologa kodem SKIER-KARD.
print("E-skierowania zewnętrzne w P1…")
try:
    jan_pesel = api("GET", f"/patients/{jan_id}", reg).json()["pesel"]
    tom_pesel = api("GET", f"/patients/{tom_id}", reg).json()["pesel"]
    for code, pesel, spec in [("SKIER-KARD", jan_pesel, "Kardiolog"),
                              ("SKIER-INT", tom_pesel, "Internista")]:
        r = httpx.post(f"{settings.p1_base_url.rstrip('/')}/api/v1/external-referrals",
                       json={"code": code, "pesel": pesel, "specialization": spec}, timeout=10)
        print(f"  {code} → {spec}: {r.status_code}")
except (httpx.HTTPError, KeyError) as exc:
    print(f"  ! pominięto (P1-mock niedostępny?): {exc}")

# --- Tomasz: wizyta zakończona (Internista Zieliński, Piastów) ---------------
print("Tomasz — wizyta, dokumenty, opinia…")
t1 = completed_visit(piastow, ziel, ziel_id, tom_id, days_ago=9, note=(
    "Wywiad: gorączka do 38,8°C, ból gardła, kaszel od 3 dni.\n"
    "Badanie: gardło zaczerwienione, węzły podżuchwowe powiększone, osłuchowo bez zmian.\n"
    "Rozpoznanie: J06 Ostre zakażenie górnych dróg oddechowych.\n"
    "Zalecenia: antybiotyk, leżenie, nawadnianie; zwolnienie 5 dni."))
issue(f"/patients/{tom_id}/prescriptions", ziel, {"appointment_id": t1, "icd10": "J06", "drugs": "Amoksycylina 500 mg, co 8 h przez 7 dni"})
issue(f"/patients/{tom_id}/sick-leaves", ziel, {"appointment_id": t1,
      "date_from": (datetime.now() - timedelta(days=9)).date().isoformat(),
      "date_to": (datetime.now() - timedelta(days=4)).date().isoformat(),
      "indication": "chory powinien leżeć"})
finish(t1, ziel)
issue("/reviews", tom, {"appointment_id": t1, "doctor_rating": 4, "clinic_rating": 5,
                        "doctor_comment": "Konkretnie i rzeczowo, szybko postawiona diagnoza."})

# nadchodząca wizyta Tomasza w Ursusie (multi-placówka)
upcoming_visit(ursus, ziel_id, tom_id, days_ahead=4, hour=10, service_id=INTERN_U)

# --- badania diagnostyczne (pracownia placówki, bez lekarza) ----------------
# Pulę WOLNYCH terminów LEKARSKICH dostarcza seed-services.py (sloty usługowe).
# Tu dokładamy tylko badania pracowniane, których seed-services nie tworzy.
print("Badania diagnostyczne (pracownia)…")
for day in (2, 4):
    base = datetime.now() + timedelta(days=day)
    api("POST", f"/clinics/{piastow}/slots", reg, json={
        "service_name": "USG jamy brzusznej",
        "datetimes": [base.replace(hour=8, minute=0, second=0, microsecond=0).isoformat()]})
    api("POST", f"/clinics/{piastow}/slots", reg, json={
        "service_name": "RTG klatki piersiowej", "referral_required": True,
        "datetimes": [base.replace(hour=8, minute=30, second=0, microsecond=0).isoformat()]})
print("  badania diagnostyczne: dodane")

# --- cofnięcie dat zakończonych wizyt (realistyczna historia) ---------------
print("Cofanie dat wizyt zakończonych (historia)…")
from app.core.db import SessionLocal  # noqa: E402
from app.models import Appointment, MedicalDocument, ClinicalNote, Review  # noqa: E402
db = SessionLocal()
try:
    for aid, days_ago in to_backdate:
        au = uuid.UUID(aid)
        target = (datetime.now() - timedelta(days=days_ago)).replace(hour=10, minute=0, second=0, microsecond=0)
        a = db.get(Appointment, au)
        if a:
            a.appointment_datetime = target
        for d in db.query(MedicalDocument).filter(MedicalDocument.appointment_id == au).all():
            d.issued_at = target
        n = db.query(ClinicalNote).filter(ClinicalNote.appointment_id == au).one_or_none()
        if n:
            n.created_at = target
            if n.signed_at:
                n.signed_at = target
        # opinia wystawiona po wizycie — data też cofnięta (inaczej „dziś")
        for rv in db.query(Review).filter(Review.appointment_id == au).all():
            rv.created_at = target
    db.commit()
finally:
    db.close()

print(f"\nGotowe. Wizyt zakończonych: {len(to_backdate)}; nadchodzących: 3 (usługowe). "
      "Wolne terminy lekarskie: z seed-services.py.")
print("Zaloguj się jako pacjent (np. janina.wisniewska@novamed.dev / NovaMed.Test1),")
print("lekarz (a.kowalczyk@…) lub rejestracja, żeby przeklikać dane.")
