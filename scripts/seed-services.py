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


# usługi implikowane przez specjalizację: (nazwa, czas, cena|None=NFZ, skierowanie, opis, czy_dodatkowa)
# „dodatkowa" = USG/echo/pakiet (nakłada się z konsultacją); reszta to konsultacja-baza.
CATALOG = {
    "Kardiolog": [
        ("Konsultacja kardiologiczna", 20, None, True, None, False),
        ("Echo serca (USG)", 20, 150, False, "Badanie echokardiograficzne serca.", True),
        ("Konsultacja kardiologiczna + echo serca", 40, 250, False,
         "Konsultacja kardiologa wraz z badaniem echo serca w jednej wizycie.", True),
    ],
    "Internista": [
        ("Konsultacja internistyczna", 15, None, False, None, False),
        ("USG jamy brzusznej", 30, 180, False, "Badanie USG narządów jamy brzusznej.", True),
    ],
    "Diabetolog": [
        ("Konsultacja diabetologiczna", 20, None, True, None, False),
    ],
    "Endokrynolog": [
        ("Konsultacja endokrynologiczna", 20, None, True, None, False),
        ("USG tarczycy", 20, 160, False, "Badanie USG tarczycy.", True),
    ],
}

DAY_BASES = [2, 3, 6, 9]     # offsety dni; przesuwane per placówka (lekarz w 2 placówkach
CLINIC_DAY_STRIDE = 10       #   = rozłączne dni, więc nie jest „dostępny" w dwóch miejscach naraz)
CONSULT_HOURS = [9, 10, 11]  # godziny konsultacji-bazy
OVERLAP_HOUR = 10            # o tej godz. dokładamy usługi dodatkowe → współrezerwacja
EXTRA_HOUR = 13             # dedykowana godzina usług dodatkowych (bez nakładania)


def at(day_off: int, hour: int) -> str:
    return (datetime.now() + timedelta(days=day_off)).replace(
        hour=hour, minute=0, second=0, microsecond=0).isoformat()


def clear_free_service_slots(adm, clinic_id):
    """Sprząta wolne sloty USŁUGOWE placówki — idempotentny, czysty re-seed."""
    n = 0
    for s in c.get(f"{API}/slots", headers=adm, params={"clinic_id": clinic_id}).json():
        if s.get("service_id"):
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
        removed = clear_free_service_slots(adm, cid)
        if removed:
            print(f"   wyczyszczono starych wolnych slotów usługowych: {removed}")
        existing = {s["name"]: s for s in c.get(f"{API}/clinics/{cid}/services", headers=adm).json()}

        # 1) usługi + przypięcie lekarzy wg specjalizacji
        # mapowanie: nazwa usługi -> (service_id, definicja, lekarze)
        wanted: dict[str, dict] = {}
        for d in doctors:
            for spec in d["specializations"]:
                for (name, dur, price, ref, desc, extra) in CATALOG.get(spec, []):
                    w = wanted.setdefault(name, {"dur": dur, "price": price, "ref": ref,
                                                 "desc": desc, "extra": extra, "doctor_ids": set()})
                    w["doctor_ids"].add(d["doctor_id"])

        svc_id: dict[str, str] = {}
        for name, w in wanted.items():
            s = existing.get(name)
            if s is None:
                s = c.post(f"{API}/clinics/{cid}/services", headers=adm, json={
                    "name": name, "duration_min": w["dur"], "price": w["price"],
                    "referral_required": w["ref"], "description": w["desc"],
                }).json()
            svc_id[name] = s["service_id"]
            c.put(f"{API}/clinics/{cid}/services/{s['service_id']}/doctors", headers=adm,
                  json={"doctor_ids": list(w["doctor_ids"])})
            print(f"   usługa: {name:42} {w['dur']}min {('%d zł' % w['price']) if w['price'] else 'NFZ':>6}  lekarzy={len(w['doctor_ids'])}")

        # 2) terminy: konsultacja-baza w siatce godzin; usługi dodatkowe nakładają
        #    się o OVERLAP_HOUR (demo współrezerwacji) + dedykowane o EXTRA_HOUR
        for d in doctors:
            did = d["doctor_id"]
            mine = [(name, wanted[name]) for name in wanted if did in wanted[name]["doctor_ids"]]
            base = [(n, w) for n, w in mine if not w["extra"]]
            extras = [(n, w) for n, w in mine if w["extra"]]
            tot = 0
            for name, _w in base:
                tot += make_slots(adm, cid, did, svc_id[name],
                                  [at(dd, h) for dd in days for h in CONSULT_HOURS])
            for name, _w in extras:
                tot += make_slots(adm, cid, did, svc_id[name],
                                  [at(dd, OVERLAP_HOUR) for dd in days[:2]]      # nakładające
                                  + [at(dd, EXTRA_HOUR) for dd in days[:2]])     # dedykowane
            print(f"   terminy dla {d['name']}: +{tot}")
    print("Gotowe.")


if __name__ == "__main__":
    main()
