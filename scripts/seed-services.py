# Seed katalogu usług (typów wizyt) + terminów usługowych — przez API NA ŻYWO,
# tak jak robi to aplikacja. Dla każdej placówki tworzy usługi pasujące do
# specjalizacji jej lekarzy (konsultacje NFZ, USG/echo prywatne, pakiet),
# przypina je właściwym lekarzom i dodaje wolne terminy. Część terminów
# NAKŁADA SIĘ czasowo (konsultacja + USG/echo o tej samej godzinie) — żeby
# pokazać współrezerwację (rezerwacja jednego znika drugi). Idempotentny:
# istniejące usługi reużywa, zduplikowane terminy (409) pomija.
#
# Wymaga backendu (:8000). Użycie:  cd backend; .venv\Scripts\python.exe ..\scripts\seed-services.py
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import httpx  # noqa: E402
from app.core.config import settings  # noqa: E402

API = "https://127.0.0.1:8000"
ROOT = Path(__file__).resolve().parents[1]
ANON = next(line.split("=", 1)[1].strip()
            for line in (ROOT / "frontend" / ".env.development").read_text(encoding="utf-8").splitlines()
            if line.startswith("VITE_SUPABASE_ANON_KEY="))
c = httpx.Client(verify=False, timeout=30)


def login(email: str) -> dict:
    r = httpx.post(f"{settings.supabase_url}/auth/v1/token?grant_type=password",
                   headers={"apikey": ANON, "Content-Type": "application/json"},
                   json={"email": email, "password": "NovaMed.Test1"}, timeout=30)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# usługi implikowane przez specjalizację:
#   (nazwa, czas, cena|None=NFZ, skierowanie, opis, czy_dodatkowa, teleporada)
# „dodatkowa" = USG/echo/pakiet (nakłada się z konsultacją); reszta to konsultacja-baza.
# „teleporada" = czy usługę można odbyć jako wideo — konsultacje TAK, badania/pakiet NIE.
CATALOG = {
    "Kardiolog": [
        ("Konsultacja kardiologiczna", 20, None, True, None, False, True),
        ("Konsultacja kardiologiczna (prywatnie)", 20, 200, False, "Wizyta prywatna — bez skierowania.", False, True),
        ("Echo serca (USG)", 20, 150, False, "Badanie echokardiograficzne serca.", True, False),
        ("Konsultacja kardiologiczna + echo serca", 40, 250, False,
         "Konsultacja kardiologa wraz z badaniem echo serca w jednej wizycie.", True, False),
    ],
    "Internista": [
        ("Konsultacja internistyczna", 15, None, False, None, False, True),
        ("Konsultacja internistyczna (prywatnie)", 15, 150, False, "Wizyta prywatna — bez skierowania.", False, True),
        ("USG jamy brzusznej", 30, 180, False, "Badanie USG narządów jamy brzusznej.", True, False),
    ],
    "Diabetolog": [
        ("Konsultacja diabetologiczna", 20, None, True, None, False, True),
        ("Konsultacja diabetologiczna (prywatnie)", 20, 180, False, "Wizyta prywatna — bez skierowania.", False, True),
    ],
    "Endokrynolog": [
        ("Konsultacja endokrynologiczna", 20, None, True, None, False, True),
        ("Konsultacja endokrynologiczna (prywatnie)", 20, 180, False, "Wizyta prywatna — bez skierowania.", False, True),
        ("USG tarczycy", 20, 160, False, "Badanie USG tarczycy.", True, False),
    ],
}

DAY_BASES = list(range(1, 11))  # gęsta pula: ~10 dni per placówka (przesuwane stride'em)
CLINIC_DAY_STRIDE = 10          # lekarz w 2 placówkach = rozłączne dni (nie „dostępny" w dwóch naraz)
NFZ_HOURS = [9, 11, 13]         # godziny konsultacji NFZ
PRIV_HOURS = [10, 12, 14]       # godziny konsultacji prywatnych (rozłączne z NFZ → realny mix)
# pierwszy wolny termin danego lekarza przesunięty o N dni (np. „dopiero w połowie lipca")
DOC_DAY_SHIFT = {"dr Magdalena Sawicka": 24}
OVERLAP_HOUR = 10            # o tej godz. dokładamy usługi dodatkowe → współrezerwacja (z prywatną konsultacją)
EXTRA_HOUR = 15             # dedykowana godzina usług dodatkowych (poza godzinami konsultacji)


def at(day_off: int, hour: int) -> str:
    return (datetime.now() + timedelta(days=day_off)).replace(
        hour=hour, minute=0, second=0, microsecond=0).isoformat()


def clear_free_doctor_slots(adm, clinic_id):
    """Sprząta wolne sloty LEKARSKIE placówki (zwykłe i usługowe) — żeby lekarze
    oferowali tylko usługi z katalogu. Badań pracownianych (bez lekarza) nie rusza."""
    n = 0
    for s in c.get(f"{API}/slots", headers=adm, params={"clinic_id": clinic_id}).json():
        if s.get("doctor_id"):
            if c.delete(f"{API}/slots/{s['appointment_id']}", headers=adm).status_code == 204:
                n += 1
    return n


def make_slots(adm, clinic_id, doctor_id, service_id, datetimes):
    added = 0
    for dt in datetimes:
        r = c.post(f"{API}/clinics/{clinic_id}/slots", headers=adm,
                   json={"doctor_id": doctor_id, "service_id": service_id, "datetimes": [dt]})
        if r.status_code == 201:
            added += 1
        elif r.status_code != 409:  # 409 = już jest (idempotencja)
            print(f"      ! slot {dt[:16]}: {r.status_code} {r.text[:80]}")
    return added


def main():
    adm = login("admin@novamed.dev")
    for ci, clinic in enumerate(c.get(f"{API}/clinics", headers=adm).json()):
        cid, cname = clinic["clinic_id"], clinic["clinic_name"]
        doctors = c.get(f"{API}/clinics/{cid}/doctors", headers=adm).json()
        if not doctors:
            continue
        # rozłączne dni per placówka — lekarz w kilku placówkach nie koliduje czasowo
        days = [b + ci * CLINIC_DAY_STRIDE for b in DAY_BASES]
        print(f"== {cname} (dni +{days[0]}..+{days[-1]}) ==")
        removed = clear_free_doctor_slots(adm, cid)
        if removed:
            print(f"   wyczyszczono starych wolnych slotów usługowych: {removed}")
        existing = {s["name"]: s for s in c.get(f"{API}/clinics/{cid}/services", headers=adm).json()}

        # 1) usługi + przypięcie lekarzy wg specjalizacji
        # mapowanie: nazwa usługi -> (service_id, definicja, lekarze)
        wanted: dict[str, dict] = {}
        for d in doctors:
            for spec in d["specializations"]:
                for (name, dur, price, ref, desc, extra, online) in CATALOG.get(spec, []):
                    w = wanted.setdefault(name, {"dur": dur, "price": price, "ref": ref,
                                                 "desc": desc, "extra": extra, "online": online, "doctor_ids": set()})
                    w["doctor_ids"].add(d["doctor_id"])

        svc_id: dict[str, str] = {}
        for name, w in wanted.items():
            body = {"name": name, "duration_min": w["dur"], "price": w["price"],
                    "referral_required": w["ref"], "allow_online": w["online"], "description": w["desc"]}
            s = existing.get(name)
            if s is None:
                s = c.post(f"{API}/clinics/{cid}/services", headers=adm, json=body).json()
            else:  # idempotencja po zmianie katalogu — zaktualizuj flagi (np. teleporada)
                c.patch(f"{API}/clinics/{cid}/services/{s['service_id']}", headers=adm, json=body)
            svc_id[name] = s["service_id"]
            c.put(f"{API}/clinics/{cid}/services/{s['service_id']}/doctors", headers=adm,
                  json={"doctor_ids": list(w["doctor_ids"])})
            print(f"   usługa: {name:42} {w['dur']}min {('%d zł' % w['price']) if w['price'] else 'NFZ':>6}  lekarzy={len(w['doctor_ids'])}")

        # 2) terminy: konsultacje NFZ i prywatne w ROZŁĄCZNYCH godzinach (realny mix,
        #    nie sama NFZ); usługi dodatkowe nakładają się o OVERLAP_HOUR + dedykowane o EXTRA_HOUR.
        #    Część lekarzy ma przesunięty pierwszy wolny termin (DOC_DAY_SHIFT).
        for d in doctors:
            did = d["doctor_id"]
            shift = DOC_DAY_SHIFT.get(d["name"], 0)
            mine = [(name, wanted[name]) for name in wanted if did in wanted[name]["doctor_ids"]]
            base = [(n, w) for n, w in mine if not w["extra"]]
            extras = [(n, w) for n, w in mine if w["extra"]]
            tot = 0
            for name, w in base:
                hours = PRIV_HOURS if w["price"] is not None else NFZ_HOURS  # prywatna ma cenę, NFZ nie
                tot += make_slots(adm, cid, did, svc_id[name],
                                  [at(dd + shift, h) for dd in days for h in hours])
            for name, _w in extras:
                tot += make_slots(adm, cid, did, svc_id[name],
                                  [at(dd + shift, OVERLAP_HOUR) for dd in days[:2]]   # nakładające
                                  + [at(dd + shift, EXTRA_HOUR) for dd in days[:2]])  # dedykowane
            print(f"   terminy dla {d['name']}: +{tot}")
    print("Gotowe.")


if __name__ == "__main__":
    main()
