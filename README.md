<div align="center">

# NovaMed

**Uniwersalny portal medyczny dla przychodni** — rezerwacje, telemedycyna,
e‑dokumentacja i integracje z systemami krajowymi, spięte w jeden system
z pięcioma portalami webowymi i aplikacją mobilną pacjenta.

![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Expo](https://img.shields.io/badge/Expo-000020?logo=expo&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)

</div>

> **Praca inżynierska** — Polsko‑Japońska Akademia Technik Komputerowych (PJATK).
> Autor: **Kacper Pomykała** (s27990).

---

## O projekcie

NovaMed to kompletny system zarządzania placówką medyczną w modelu SaaS dla małych
i średnich przychodni — od umówienia wizyty, przez telewizytę i prowadzenie
dokumentacji, po rozliczenia i integracje z systemami krajowymi. Jedna baza kodu
obsługuje **pięć portali webowych** (Pacjent, Lekarz, Pielęgniarka, Poradnia/Rejestracja,
Administrator) oraz **aplikację mobilną** pacjenta, a logika domenowa pozostaje czysta
dzięki architekturze **port/adapter** — integracje zewnętrzne (P1, ZUS, eWUŚ, lab,
płatności, SMS) działają jako mock‑serwisy i są wymienne na produkcyjne bez zmian w kodzie.

## Funkcje

**Pacjent**
- Rezerwacja wizyt NFZ i prywatnych — także **bez konta** (weryfikacja numeru kodem SMS)
- **Telewizyty** (wideo w przeglądarce, WebRTC) — również dla opiekuna w imieniu podopiecznego
- E‑recepty, e‑skierowania, e‑zwolnienia i wyniki badań w jednym miejscu; udostępnianie dokumentacji kodem
- **Konta rodzinne** (opiekun + podopieczni), powiadomienia in‑app / SMS / e‑mail / push
- Aplikacja **mobilna** (Expo) z trybem offline

**Personel**
- **Lekarz** — gabinet, ustrukturyzowana nota (SOAP), wystawianie e‑recept/e‑skierowań/e‑ZLA, szablony, dostawka (walk‑in)
- **Pielęgniarka** — zabiegi (także seryjne), kolejka skierowań
- **Rejestracja / Poradnia** — grafik placówki i całej sieci, meldowanie pacjentów, umawianie w imieniu, raporty
- **Administrator** — konta i role, monitoring, **dziennik RODO**, ustawienia placówek

**Integracje krajowe** *(mock‑first, production‑swappable)*
- e‑recepta / e‑skierowanie (**P1**) · e‑zwolnienie (**ZUS e‑ZLA**) · weryfikacja ubezpieczenia (**eWUŚ**) · laboratorium · płatności · SMS

## Bezpieczeństwo i zgodność

- **Szyfrowanie danych wrażliwych at‑rest** — AES‑256‑GCM kolumnowo (dokumenty, noty, wyniki, dane kliniczne, PESEL), z **blind index** (HMAC) do wyszukiwania po PESEL
- **RBAC** per rola + **izolacja multi‑tenant** (personel widzi tylko swoje placówki; dostęp międzyplacówkowy wyłącznie za zgodą pacjenta)
- **Dziennik RODO** (kto/kiedy/co) + prawo do bycia zapomnianym (anonimizacja)
- Uwierzytelnianie przez **Supabase**; w produkcji wyłącznie **ES256/JWKS**, twarde guardy startowe, CORS zawężony, wymuszony **HTTPS**

## Architektura

```
   Pacjent (mobile)  ┐
                     │            ┌──────────────┐   HTTPS / auto-TLS
   5 portali web  ───┼──────────▶ │    Caddy     │
                     ┘            │ reverse proxy│
                                  └──────┬───────┘
                       statyczny front ──┤── /api ──┐
                          (nginx, SPA)              ▼
                                            ┌──────────────┐     ┌───────────────┐
                       Supabase Auth ─JWT─▶ │   Backend    │ ──▶ │  PostgreSQL   │
                       (ES256/JWKS)         │  (FastAPI)   │     │ (AES-256 @rest)│
                                            └──────┬───────┘     └───────────────┘
                              port / adapter ──────┤
                                                   ▼
              mocki integracji:  P1 · ZUS e-ZLA · eWUŚ · lab · płatności · SMS
```

Każda integracja przechodzi przez **port/adapter** — interfejs w warstwie domeny + adapter
HTTP wskazujący na mock (URL z konfiguracji). Podmiana mock→real = nowy adapter + zmiana
env, **zero zmian w logice biznesowej**. Backend jest **bezstanowy** (sesja w JWT) i skaluje
się poziomo za load‑balancerem.

## Stack

| Warstwa | Technologie |
|---|---|
| **Backend** | Python 3.12 · FastAPI · SQLAlchemy 2 · Alembic · PostgreSQL 16 |
| **Frontend** | React · Vite · TypeScript · Tailwind |
| **Mobile** | React Native (Expo) — push, offline |
| **Auth** | Supabase Auth (JWT, ES256/JWKS w produkcji) |
| **Integracje** | 6 mock‑serwisów FastAPI (P1, ZUS, eWUŚ, lab, płatności, SMS) |
| **Infra** | Docker Compose · Caddy (automatyczny TLS) · nginx |

## Szybki start (dev)

Całe środowisko jedną komendą (Windows, PowerShell):
```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-dev.ps1
```
Podnosi backend (`:8000`), frontend (`:5174`) i 6 mocków (`:8101–8106`) + konta i słowniki.

Pojedyncze komponenty: backend z `backend/` na własnym venv (`python -m uvicorn app.main:app --reload`,
testy `python -m pytest -q`, migracje `python -m alembic upgrade head`); frontend z `frontend/`
(`npm install && npm run dev`). Konta i dane: `scripts/provision-users.py`, `scripts/import-dictionaries.py`,
`scripts/seed-services.py`, `scripts/seed-demo-data.py`.

**Konta testowe** (hasło `NovaMed.Test1`):

| Rola | E‑mail |
|---|---|
| Pacjent | `janina.wisniewska@novamed.dev` |
| Lekarz | `a.kowalczyk@novamed.dev` |
| Pielęgniarka | `k.lis@novamed.dev` |
| Rejestracja | `rejestracja@novamed.dev` |
| Administrator | `admin@novamed.dev` |

## Wdrożenie (jeden VPS, publiczny URL)

Turnkey przez Docker Compose — backend + mocki + Postgres + frontend za Caddy z automatycznym TLS:
```bash
cp deploy/.env.prod.example deploy/.env      # uzupełnij domenę + Supabase + klucze
docker compose -f deploy/docker-compose.prod.yml up -d --build
```
Świeży VPS od zera do działającego `https://twoja-domena` (DNS, firewall, Supabase ES256, dane demo) →
**[`deploy/DEPLOY_VPS.md`](deploy/DEPLOY_VPS.md)** — krok po kroku, z firewallem, DNS i kontami startowymi.

## Jakość

- **250+ testów** (pytest), pokrycie backendu **≥ 90 %** (próg NFR)
- Dostępność **WCAG 2.1 AA** (audyt axe‑core na wszystkich ekranach)
- Wydajność: indeksy hot‑ścieżek + skalowanie poziome (backend bezstanowy, repliki za load‑balancerem)

## Struktura repozytorium

```
backend/     FastAPI — API domenowe, RBAC, szyfrowanie, integracje (port/adapter)
frontend/    React (Vite, TS) — 5 portali w jednej aplikacji
mobile/      Expo — aplikacja pacjenta (push, offline)
mocks/       mock-serwisy: p1, zus_ezla, ewus, lab, payments, sms
scripts/     narzędzia: provisioning kont, słowniki, seed danych, backup
deploy/      wdrożenie na VPS (Docker Compose, Caddy, runbook)
```

## Autor

**Kacper Pomykała** — praca inżynierska, Polsko‑Japońska Akademia Technik Komputerowych (PJATK), nr albumu **s27990**.
