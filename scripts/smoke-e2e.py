# Smoke test E2E na ŻYWYM środowisku (start-dev + Supabase + mocki).
# Przechodzi pełne przepływy biznesowe wszystkich ról przez prawdziwe API
# z prawdziwymi tokenami Supabase. Tworzy dane w bazie dev (to celowe —
# zostają jako materiał do klikania). Bezpieczny do wielokrotnego uruchamiania
# (unikalne minuty slotów per bieg, 409-y traktowane jako "już jest").
#
# Użycie:  cd backend; .venv\Scripts\python.exe ..\scripts\smoke-e2e.py
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # konsola cp1250 vs polskie znaki

import httpx  # noqa: E402

from app.core.config import settings  # noqa: E402

API = "https://127.0.0.1:8000"
FRONT = "https://127.0.0.1:5174"
PASSWORD = "NovaMed.Test1"

ANON = next(
    (line.split("=", 1)[1].strip()
     for line in (ROOT / "frontend" / ".env.development").read_text(encoding="utf-8").splitlines()
     if line.startswith("VITE_SUPABASE_ANON_KEY=")),
    "",
)

# sloty na siatce 15 min; daleko w przyszłość (poza ~14-dniowe dane testowe)
# i w minuty :15/:45 (dane testowe są na :00/:30) — unika kolizji z gęstym grafikiem
RUN = int(time.time() // 60)
MINUTE = (RUN % 2) * 30 + 15        # 15 albo 45
BASE_DAYS = 40 + (RUN % 120)        # 40–159 dni w przód, szeroki zakres per bieg (anty-kolizja)

passed, failed = [], []


def check(name: str, cond: bool, detail: str = ""):
    (passed if cond else failed).append(name)
    mark = "OK " if cond else "FAIL"
    print(f"  [{mark}] {name}" + (f"  ({detail})" if detail and not cond else ""))


def sb_login(email: str) -> str:
    for attempt in range(3):
        r = httpx.post(
            f"{settings.supabase_url}/auth/v1/token?grant_type=password",
            headers={"apikey": ANON},
            json={"email": email, "password": PASSWORD}, timeout=30,
        )
        if r.status_code == 200:
            return r.json()["access_token"]
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"logowanie {email}: {r.status_code} {r.text[:120]}")


def api(method: str, path: str, token: str | None = None, **kw) -> httpx.Response:
    headers = kw.pop("headers", {})
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return httpx.request(method, API + path, headers=headers, verify=False, timeout=30, **kw)


def at(days: int, hour: int) -> datetime:
    return (datetime.now() + timedelta(days=BASE_DAYS + days)).replace(
        hour=hour, minute=MINUTE, second=0, microsecond=0)


def main() -> None:
    print("== A. Infrastruktura ==")
    check("API /health", api("GET", "/health").status_code == 200)
    for name, url in [("P1", settings.p1_base_url), ("ZUS", settings.zus_base_url),
                      ("eWUS", settings.ewus_base_url), ("lab", settings.lab_base_url),
                      ("płatności", settings.payments_base_url), ("SMS", settings.sms_base_url)]:
        try:
            r = httpx.get(url + "/", timeout=5)
            check(f"mock {name} odpowiada", r.status_code < 500)
        except Exception as e:
            check(f"mock {name} odpowiada", False, str(e)[:80])
    try:
        r = httpx.get(FRONT, verify=False, timeout=10)
        check("frontend serwuje HTML", r.status_code == 200 and "<div id=" in r.text)
    except Exception as e:
        check("frontend serwuje HTML", False, str(e)[:80])

    print("== B. Auth (Supabase ES256) ==")
    tokens: dict[str, str] = {}
    roles_expected = {
        "admin@novamed.dev": "administrator",
        "a.kowalczyk@novamed.dev": "lekarz",
        "k.lis@novamed.dev": "pielegniarka",
        "rejestracja@novamed.dev": "rejestracja",
        "janina.wisniewska@novamed.dev": "pacjent",
        "tomasz.borkowski@novamed.dev": "pacjent",
    }
    for email, role in roles_expected.items():
        tokens[email] = sb_login(email)
        me = api("GET", "/auth/me", tokens[email])
        check(f"login+me {email}", me.status_code == 200 and me.json()["role"] == role,
              f"{me.status_code} {me.text[:80]}")
    bad = httpx.post(f"{settings.supabase_url}/auth/v1/token?grant_type=password",
                     headers={"apikey": ANON},
                     json={"email": "janina.wisniewska@novamed.dev", "password": "zle-haslo"}, timeout=30)
    check("złe hasło odrzucone", bad.status_code in (400, 401))
    check("dev-token wyłączony", api("POST", "/auth/dev-token", json={"email": "x@x.pl"}).status_code == 404)
    check("brak tokenu = 401", api("GET", "/appointments/my").status_code == 401)
    check("pacjent nie wejdzie do admina",
          api("GET", "/admin/users", tokens["janina.wisniewska@novamed.dev"]).status_code == 403)

    reg = tokens["rejestracja@novamed.dev"]
    jan = tokens["janina.wisniewska@novamed.dev"]
    tom = tokens["tomasz.borkowski@novamed.dev"]
    kow = tokens["a.kowalczyk@novamed.dev"]
    lis = tokens["k.lis@novamed.dev"]
    adm = tokens["admin@novamed.dev"]

    print("== C. Rejestracja: placówka i terminy ==")
    clinics = api("GET", "/clinics", reg).json()
    check("lista placówek", len(clinics) >= 1)
    clinic_id = clinics[0]["clinic_id"]
    r = api("PATCH", f"/clinics/{clinic_id}/settings", adm, json={"earlier_notice_min_hours": 24})
    check("ustawienia placówki (PATCH, admin)", r.status_code == 200 and r.json()["earlier_notice_min_hours"] == 24)
    check("rejestracja NIE zmienia ustawień (403)",
          api("PATCH", f"/clinics/{clinic_id}/settings", reg, json={"earlier_notice_min_hours": 24}).status_code == 403)
    doctors = api("GET", f"/clinics/{clinic_id}/doctors", reg).json()
    check("lekarze placówki (3)", len(doctors) >= 3, str(len(doctors)))
    kow_id = next(d["doctor_id"] for d in doctors if "Kowalczyk" in d["name"])
    saw_id = next(d["doctor_id"] for d in doctors if "Sawicka" in d["name"])

    def slots(doctor_id, dts, **extra):
        return api("POST", f"/clinics/{clinic_id}/slots", reg,
                   json={"doctor_id": doctor_id, "datetimes": [d.isoformat() for d in dts], **extra})

    r = slots(kow_id, [at(3, 10), at(10, 10), at(17, 10)])  # seria "cykliczna"
    check("seria 3 slotów (201)", r.status_code == 201 and len(r.json()) == 3, f"{r.status_code} {r.text[:80]}")
    series = r.json()
    r2 = slots(kow_id, [at(4, 11)], appointment_type="ONLINE")
    check("slot ONLINE", r2.status_code == 201, r2.text[:80])
    online_slot = r2.json()[0]
    r3 = slots(kow_id, [at(5, 17)], price=200)
    r4 = slots(kow_id, [at(6, 17)], price=200)
    check("sloty płatne", r3.status_code == 201 and r4.status_code == 201)
    paid1, paid2 = r3.json()[0], r4.json()[0]
    r5 = slots(kow_id, [at(7, 12)])
    r6 = slots(kow_id, [at(14, 12)])
    early_slot, watch_slot = r5.json()[0], r6.json()[0]

    tmp = slots(kow_id, [at(20, 8)]).json()[0]
    check("usunięcie wolnego slotu (204)",
          api("DELETE", f"/slots/{tmp['appointment_id']}", reg).status_code == 204)
    check("konflikt slotu = 409", slots(kow_id, [at(3, 10)]).status_code == 409)

    print("== D. Pacjent: rezerwacje ==")
    free = api("GET", "/slots", jan).json()
    check("wyszukiwarka slotów", len(free) >= 5, str(len(free)))
    visit_id = series[0]["appointment_id"]
    r = api("POST", f"/appointments/{visit_id}/book", jan,
            json={"reason": "Kontrola ciśnienia — duszności przy wysiłku", "notify_earlier": False})
    check("rezerwacja z powodem", r.status_code == 200
          and r.json()["appointment"]["appointment_status"] == "CONFIRMED"
          and "duszności" in (r.json()["appointment"]["notes"] or ""), r.text[:100])
    mine = api("GET", "/appointments/my", jan).json()
    check("moje wizyty zawierają rezerwację", any(v["appointment_id"] == visit_id for v in mine))
    ics = api("GET", f"/appointments/{visit_id}/ics", jan)
    check("eksport ICS", ics.status_code == 200 and "BEGIN:VCALENDAR" in ics.text and "TZID=Europe/Warsaw" in ics.text)
    check("podwójna rezerwacja = 409", api("POST", f"/appointments/{visit_id}/book", tom).status_code == 409)

    # przełożenie na inny slot serii i powrót przez anulowanie
    r = api("POST", f"/appointments/{series[1]['appointment_id']}/reschedule", jan,
            json={"new_appointment_id": series[1]["appointment_id"]})
    # (reschedule wymaga: stara wizyta -> nowy slot; użyjmy poprawnie)
    r = api("POST", f"/appointments/{visit_id}/reschedule", jan,
            json={"new_appointment_id": series[1]["appointment_id"]})
    check("przełożenie wizyty", r.status_code == 200 and r.json()["appointment_status"] == "CONFIRMED", r.text[:100])
    moved_id = series[1]["appointment_id"]
    # wróć na pierwotny termin (respawn slotu po przełożeniu)
    free_now = api("GET", "/slots", jan).json()
    back = next((s for s in free_now if s["appointment_datetime"] == series[0]["appointment_datetime"]
                 and s["doctor_id"] == kow_id), None)
    check("slot po przełożeniu wrócił do puli", back is not None)
    if back:
        r = api("POST", f"/appointments/{moved_id}/reschedule", jan, json={"new_appointment_id": back["appointment_id"]})
        check("przełożenie powrotne", r.status_code == 200)
        visit_id = back["appointment_id"]

    print("== E. Płatności (TEMP_LOCK → PAID / FREE) ==")
    r = api("POST", f"/appointments/{paid1['appointment_id']}/book", jan)
    ok_lock = r.status_code == 200 and r.json()["appointment"]["appointment_status"] == "TEMP_LOCK" \
        and r.json()["payment"]["payment_status"] == "PENDING"
    check("płatny slot → TEMP_LOCK + PENDING", ok_lock, r.text[:120])
    r = api("POST", f"/appointments/{paid1['appointment_id']}/pay", jan, json={"outcome": "success"})
    check("płatność OK → CONFIRMED", r.status_code == 200
          and r.json()["appointment"]["appointment_status"] == "CONFIRMED"
          and r.json()["payment"]["payment_status"] == "PAID", r.text[:120])
    r = api("POST", f"/appointments/{paid2['appointment_id']}/book", tom)
    r = api("POST", f"/appointments/{paid2['appointment_id']}/pay", tom, json={"outcome": "failure"})
    check("odmowa płatności → slot FREE", r.status_code == 200
          and r.json()["appointment"]["appointment_status"] == "FREE", r.text[:120])

    print("== F. 'Powiadom o wcześniejszym terminie' ==")
    api("POST", f"/appointments/{watch_slot['appointment_id']}/book", jan, json={"notify_earlier": True})
    api("POST", f"/appointments/{early_slot['appointment_id']}/book", tom)
    api("POST", f"/appointments/{early_slot['appointment_id']}/cancel", tom)
    notes = api("GET", "/notifications/my", jan).json()
    check("obserwator dostał powiadomienie o wcześniejszym terminie",
          any("wcześniejszy termin" in n["notification_title"] for n in notes))

    print("== G. Lista oczekujących ==")
    r = api("POST", "/waiting-list", jan, json={"specialization": "Endokrynolog"})
    check("zapis na listę oczekujących", r.status_code in (200, 201, 409), r.text[:80])
    slots(saw_id, [at(8, 9)])
    notes = api("GET", "/notifications/my", jan).json()
    check("powiadomienie 'nowe terminy' po dodaniu slotów",
          any("Nowe terminy" in n["notification_title"] for n in notes))
    check("wpis zniknął z listy", api("GET", "/waiting-list/my", jan).json() == [])

    print("== H. Lekarz: wizyta i dokumenty ==")
    day = series[0]["appointment_datetime"][:10]
    dayview = api("GET", f"/appointments/day?day={day}", kow).json()
    check("grafik dnia zawiera wizytę z powodem",
          any(v["appointment_id"] == visit_id and "duszności" in (v["notes"] or "") for v in dayview))
    r = api("POST", f"/appointments/{visit_id}/status", kow, json={"new_status": "IN_PROGRESS"})
    check("start wizyty (IN_PROGRESS)", r.status_code == 200, r.text[:80])
    jan_id = next(v["patient_id"] for v in dayview if v["appointment_id"] == visit_id)
    info = api("GET", f"/patients/{jan_id}", kow).json()
    check("karta pacjenta (eWUŚ, bez opiekuna)", "insurance_status" in info and info["guardian_name"] is None)
    icd = api("GET", "/dictionaries/icd10?q=nadciś", kow).json()
    check("słownik ICD-10 podpowiada", any(e["code"] == "I10" for e in icd))
    meds = api("GET", "/dictionaries/medications?q=ator", kow).json()
    check("słownik leków podpowiada", len(meds) >= 1)

    rx = api("POST", f"/patients/{jan_id}/prescriptions", kow,
             json={"appointment_id": visit_id, "icd10": "I10",
                   "drugs": "Atorvasterol 40 mg ×30 tabl. — D.S. 1×1 wieczorem"})
    check("e-recepta przez P1", rx.status_code == 201 and rx.json()["document_status"] == "CONFIRMED"
          and rx.json()["code"], rx.text[:120])
    ref = api("POST", f"/patients/{jan_id}/referrals", kow,
              json={"appointment_id": visit_id, "icd10": "I10", "referral_type": "NURSING",
                    "notes": "Iniekcje domięśniowe 1×dz. przez 5 dni"})
    check("skierowanie na zabieg (NURSING)", ref.status_code == 201 and ref.json()["document_status"] == "ACTIVE")
    zla = api("POST", f"/patients/{jan_id}/sick-leaves", kow,
              json={"appointment_id": visit_id,
                    "date_from": datetime.now().date().isoformat(),
                    "date_to": (datetime.now() + timedelta(days=4)).date().isoformat()})
    check("e-ZLA przez ZUS", zla.status_code == 201 and zla.json()["document_status"] == "SENT", zla.text[:120])
    note = api("PUT", f"/appointments/{visit_id}/note", kow,
               json={"content": "Wywiad: kontrola NT.\n\nRozpoznanie: I10\n\nZalecenia: kontrola za 4 tygodnie."})
    check("nota z wizyty (szkic)", note.status_code == 200 and note.json()["status"] == "DRAFT")
    pdf = api("GET", f"/documents/{rx.json()['document_id']}/pdf", kow)
    check("PDF dokumentu", pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf")
    r = api("POST", f"/appointments/{visit_id}/status", kow, json={"new_status": "COMPLETED"})
    check("zakończenie wizyty", r.status_code == 200)
    signed = api("GET", f"/appointments/{visit_id}/note", kow)
    check("nota auto-podpisana po zakończeniu", signed.status_code == 200 and signed.json()["status"] == "SIGNED",
          signed.text[:120])

    print("== I. Opinia po wizycie ==")
    r = api("POST", "/reviews", jan, json={"appointment_id": visit_id, "doctor_rating": 5,
                                           "doctor_comment": "Bardzo rzeczowa rozmowa.", "clinic_rating": 4})
    check("wystawienie opinii", r.status_code == 201, r.text[:100])
    dr = api("GET", f"/reviews/doctor/{kow_id}", jan).json()
    check("średnia ocen lekarza", dr["count"] >= 1 and dr["average"] is not None)

    print("== J. Pielęgniarka: zabieg ==")
    queue = api("GET", "/referrals/nursing", lis).json()
    check("kolejka skierowań", any(d["document_id"] == ref.json()["document_id"] for d in queue))
    r = api("POST", "/procedures", lis, json={
        "referral_document_id": ref.json()["document_id"],
        "procedure_datetime": at(1, 9).isoformat(),
    })
    check("zaplanowanie zabiegu", r.status_code == 201 and r.json()["procedure_status"] == "PLANNED", r.text[:100])
    proc_id = r.json().get("procedure_id")
    if proc_id:
        r = api("POST", f"/procedures/{proc_id}/complete", lis,
                json={"notes": "Iniekcja podana, bez odczynu miejscowego."})
        check("wykonanie zabiegu + dokumentacja", r.status_code == 200 and r.json()["procedure_status"] == "DONE")
    queue2 = api("GET", "/referrals/nursing", lis).json()
    check("skierowanie zniknęło z kolejki", all(d["document_id"] != ref.json()["document_id"] for d in queue2))

    print("== K. Udostępnianie kodem (UC-P6) ==")
    sh = api("POST", "/shares", jan, json={"scope": "ALL", "hours_valid": 24})
    check("generowanie kodu", sh.status_code in (200, 201) and sh.json()["access_code"], sh.text[:100])
    code = sh.json()["access_code"]
    acc = api("POST", "/shares/access", kow, json={"code": code})
    check("personel otwiera kodem (dokumenty)", acc.status_code == 200 and len(acc.json()["documents"]) >= 3,
          acc.text[:100])
    api("DELETE", f"/shares/{sh.json()['share_id']}", jan)
    check("unieważniony kod = 410", api("POST", "/shares/access", kow, json={"code": code}).status_code == 410)
    check("nieistniejący kod = 404", api("POST", "/shares/access", kow, json={"code": "XXX-000"}).status_code == 404)

    print("== L. Konta rodzinne + telemedycyna ==")
    dep = api("POST", "/family", jan, json={"first_name": "Staś", "last_name": "Wiśniewski",
                                            "pesel": "19251012342", "birth_date": "2019-05-10"})
    if dep.status_code == 409:  # ponowny bieg — podopieczny już jest
        dep_id = api("GET", "/family", jan).json()[0]["patient_id"]
    else:
        check("dodanie podopiecznego", dep.status_code == 201, dep.text[:100])
        dep_id = dep.json()["patient_id"]
    check("zły PESEL odrzucony (422)",
          api("POST", "/family", jan, json={"first_name": "X", "last_name": "Y", "pesel": "12345678901",
                                            "birth_date": "2020-01-01"}).status_code == 422)
    r = api("POST", f"/appointments/{online_slot['appointment_id']}/book?as_patient={dep_id}", jan)
    check("teleporada dla podopiecznego", r.status_code == 200 and r.json()["appointment"]["patient_id"] == dep_id,
          r.text[:100])
    tele_id = online_slot["appointment_id"]
    info = api("GET", f"/patients/{dep_id}", kow).json()
    check("lekarz widzi opiekuna podopiecznego", info["guardian_name"] and info["guardian_phone"] == "601234567")
    up = api("POST", f"/telemed/{tele_id}/attachments", jan,
             files={"file": ("wyniki.txt", b"morfologia w normie", "text/plain")})
    check("załącznik telewizyty (opiekun)", up.status_code == 201, up.text[:100])
    if up.status_code == 201:
        check("pobranie załącznika (opiekun)", api("GET", up.json()["url"], jan).status_code == 200)
        check("obcy bez dostępu do załącznika (403)", api("GET", up.json()["url"], tom).status_code == 403)
    deps_visits = api("GET", f"/appointments/my?as_patient={dep_id}", jan).json()
    check("wizyty podopiecznego widoczne dla opiekuna", any(v["appointment_id"] == tele_id for v in deps_visits))
    notes = api("GET", "/notifications/my", jan).json()
    check("powiadomienie podopiecznego trafiło do opiekuna",
          any("Staś" in n["notification_content"] for n in notes))

    print("== M. Powiadomienia + SMS ==")
    unread = api("GET", "/notifications/unread-count", jan).json()["unread"]
    check("licznik nieprzeczytanych > 0", unread > 0, str(unread))
    r = api("POST", "/notifications/read-all", jan)
    check("oznacz wszystkie przeczytane", r.status_code == 200 and r.json()["unread"] == 0)
    try:
        outbox = httpx.get(settings.sms_base_url + "/api/v1/outbox", timeout=5).json()
        check("SMS w outboksie mocka", any("601234567" in str(s) for s in outbox), str(len(outbox)))
    except Exception as e:
        check("SMS w outboksie mocka", False, str(e)[:80])

    print("== N. Raporty + admin ==")
    # raportujemy miesiąc, w którym smoke FAKTYCZNIE umawia wizyty (at(3,10) = wizyta
    # główna), nie bieżący wg zegara — sloty są BASE_DAYS w przód, więc bieżący
    # miesiąc bywa pusty (przechodziło wcześniej tylko dzięki nazbieranym danym)
    month = at(3, 10).strftime("%Y-%m")
    rep = api("GET", f"/clinics/{clinic_id}/reports?month={month}", reg)
    check("raport miesiąca", rep.status_code == 200 and rep.json()["total_booked"] >= 1, rep.text[:100])
    csv = api("GET", f"/clinics/{clinic_id}/reports/csv?month={month}", reg)
    check("raport CSV", csv.status_code == 200 and ";" in csv.text or "," in csv.text)
    users = api("GET", "/admin/users", adm).json()
    check("admin: lista użytkowników", len(users) >= 8, str(len(users)))
    integ = api("GET", "/admin/integrations", adm).json()
    check("admin: statusy integracji (wszystkie OK)",
          all(i["status"] == "OK" for i in integ), str([(i['name'], i['status']) for i in integ])[:120])
    check("admin: statystyki", api("GET", "/admin/stats", adm).status_code == 200)
    tom_id = next(u["user_id"] for u in users if u["email"] == "tomasz.borkowski@novamed.dev")
    api("POST", f"/admin/users/{tom_id}/toggle-active", adm)
    check("zablokowane konto = 403", api("GET", "/auth/me", tom).status_code == 403)
    api("POST", f"/admin/users/{tom_id}/toggle-active", adm)
    check("odblokowane konto działa", api("GET", "/auth/me", tom).status_code == 200)

    print("\n" + "=" * 60)
    print(f"WYNIK: {len(passed)} OK, {len(failed)} FAIL")
    if failed:
        print("Niezaliczone:")
        for f in failed:
            print(f"  - {f}")
        sys.exit(1)


if __name__ == "__main__":
    import warnings
    warnings.filterwarnings("ignore")
    main()
