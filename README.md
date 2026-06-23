# NovaMed — Uniwersalny Portal Medyczny (praca inżynierska, PJATK, s27990)

Platforma SaaS dla małych/średnich placówek medycznych: rezerwacje wizyt, centralna
dokumentacja medyczna (e-recepty, e-skierowania, e-zwolnienia, wyniki badań),
telemedycyna, 5 portali (Pacjent, Lekarz, Pielęgniarka, Poradnia, Admin) + aplikacja
mobilna pacjenta + integracje z systemami krajowymi (mockowane).

## Źródło prawdy

- **Zakres MVP** = całość `DokumentacjaWord_PracaInzynierska_s27990_wersja_2 (1).docx`
  (tekst wyciągnięty do `docs/dokumentacja-docx.txt`). Wszystko z docx musi być.
- Docx jest **poglądowy** — możemy robić inaczej, jeśli to logicznie/funkcjonalnie lepsze,
  ale KAŻDE odstępstwo zapisujemy w `docs/md` (potem trafi do finalnej dokumentacji).
- Diagramy trzymamy **jako kod** w `diagramy` (DBML dla ERD, PlantUML dla UML).
  Oryginalne obrazki z docx: `diagramy*.{png,jpg,jpeg}`.
- Plan i postęp: `docs/PROJEKT.md`.

## Stack (ustalony z autorem)

- **Backend**: Python, FastAPI + SQLAlchemy 2.x + Alembic, PostgreSQL
- **Auth**: **Supabase Auth** (cloud) — rejestracja/logowanie/reset/2FA po stronie Supabase;
  backend weryfikuje JWT (Bearer) i mapuje `sub` → `app_user.supabase_uid`; role/RBAC nasze
  (tabela `role`). Sekrety w `backend/.env`: `SUPABASE_URL`, `SUPABASE_JWT_SECRET`,
  `SUPABASE_SERVICE_ROLE_KEY` (tylko dla `scripts/provision-users.py`)
- **Dane wrażliwe at-rest**: szyfrowane **AES-256-GCM** kolumnowo (`app/core/crypto.py`,
  typ `Encrypted`) — treść dokumentów/not, wyniki, dane kliniczne, PESEL; PESEL wyszukiwany
  przez blind index `pesel_bidx`=HMAC. Klucze: `DATA_ENCRYPTION_KEY`/`DATA_INDEX_KEY`
  (prod wymaga; dev = pochodna z JWT-secret).
- **Frontend web**: React (Vite + TypeScript) — 5 portali w jednej aplikacji, routing per rola
- **Mobile**: React Native (Expo) — aplikacja pacjenta (push, offline cache)
- **Integracje zewnętrzne** (P1, ZUS e-ZLA, eWUŚ, laboratoria, płatności): **własne
  mock-serwisy** — osobne małe serwisy FastAPI z realistycznym API, w `mocks/`
- **Infra dev**: Docker Compose (Postgres + serwisy)

## Reguła integracji: mock-first, ale production-swappable

Każda integracja zewnętrzna przechodzi przez **port/adapter**: interfejs w warstwie domeny
backendu, implementacja jako adapter HTTP wskazujący na mock-serwis (URL z env).
Mock implementuje **realistyczny kontrakt** (tam gdzie się da — wzorowany na publicznej
dokumentacji P1/eWUŚ/ZUS/operatorów płatności). Podmiana mock→real = nowy adapter +
zmiana konfiguracji, **zero zmian w logice domenowej**. Logika biznesowa nigdy nie
importuje niczego specyficznego dla mocka.

## Planowana struktura repo

```
backend/     FastAPI — API główne (moduły domenowe)
frontend/    React — portale webowe
mobile/      Expo — aplikacja pacjenta
mocks/       mock-serwisy: p1/, zus_ezla/, ewus/, lab/, payments/
mockupy-ui/  klikalne makiety całego UI (Vite+React+Tailwind, dane statyczne)
             — referencja wyglądu/UX dla frontend/; `npm run dev` → localhost:5173
docs/        dokumentacja, plan, odstępstwa, diagramy
```

## Design

**`system designu` obowiązuje przy KAŻDYM ekranie** (web i mobile). Kierunek v3 (zatwierdzony
przez autora): hybryda „Soft Clinical × Bento" — tło gray-50, białe kafle 20px z miękkim cieniem,
pigułkowe przyciski, Plus Jakarta Sans, primary teal #0F766E (teal-700, WCAG AA; jeden, bez akcentów per rola),
siatka bento na dashboardach (sama składa się na mobile), soft chipy statusów.
**Zasada nadrzędna: restraint** — max 1 akcja primary + 1 secondary na kafel, dashboard 4–5
kafli, listy skrócone + „Wszystkie". WCAG AA, microcopy po polsku. Implementacja referencyjna:
`mockupy-ui/src/{index.css,ui.tsx}`. Nie wymyślamy stylów per ekran — tylko tokeny ze wspólnym systemem designu.

## Komendy dev

- **Całe środowisko jedną komendą**: `powershell -ExecutionPolicy Bypass -File scripts\start-dev.ps1`
  (5 mocków + backend + frontend + seed; idempotentny). Stop: `scripts\stop-dev.ps1`.
- **Dostęp z sieci lokalnej**: front i API słuchają na 0.0.0.0; frontend sam celuje w API
  na hoście/protokole z paska adresu (puste `VITE_API_URL`), CORS wpuszcza adresy prywatne.
  Wymaga reguły firewalla (raz, jako admin):
  `New-NetFirewallRule -DisplayName 'NovaMed dev' -Direction Inbound -Protocol TCP -LocalPort 5174,8000 -Action Allow`
- **HTTPS dev** (wymagane przez kamerę/mikrofon przy wejściu z LAN): certy generuje
  `backend\.venv\Scripts\python.exe scripts\make-cert.py` (→ `certs/`, gitignore; SAN z IP
  maszyny — po zmianie sieci wygeneruj ponownie). start-dev podnosi wtedy front i API po
  HTTPS. Na każdym urządzeniu testowym trzeba RAZ zaakceptować ostrzeżenie przeglądarki
  dla **obu** originów: `https://HOST:5174` i `https://HOST:8000` (np. otwierając /health).

- **Baza**: lokalna usługa PostgreSQL 16 (Windows, port 5432) — Docker na tej maszynie nie działa
  (uszkodzony WSL); `docker-compose.yml` to wariant wdrożeniowy. URL: `backend/.env` (`DATABASE_URL`).
- **Backend** (z `backend/`, venv w `backend/.venv`):
  - testy: `.\.venv\Scripts\python.exe -m pytest -q`
  - pokrycie (NFR M10, próg ≥90%): `.\.venv\Scripts\python.exe -m pytest --cov --cov-report=term-missing` (konfiguracja w `backend/.coveragerc`)
  - serwer: `.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload`
  - migracje: `.\.venv\Scripts\python.exe -m alembic upgrade head` (nowa: `... revision --autogenerate -m "..."`)
- **Mock-serwisy** (venv backendu; z katalogu danego mocka, `..\..\backend\.venv\Scripts\python.exe -m uvicorn main:app --port <PORT>`):
  - P1 → 8101, ZUS e-ZLA → 8102, eWUŚ → 8103, laboratorium → 8104, płatności → 8105,
    SMS → 8106 (podgląd wysłanych: GET /api/v1/outbox)
- **Frontend** (z `frontend/`): `npm run dev` → localhost:5174 (oczekuje API na :8000).
  Auth: tryb dev (`/auth/dev-token`, hasła niesprawdzane) dopóki `VITE_SUPABASE_URL`
  puste w `frontend/.env.development`; po wpisaniu kluczy Supabase przełącza się sam.
- **Konta testowe**: `backend> .\.venv\Scripts\python.exe ..\scripts\provision-users.py`
  (idempotentny; admin/3 lekarzy/pielęgniarka/rejestracja/2 pacjentów, np.
  `janina.wisniewska@novamed.dev`). Bez kluczy Supabase: tryb dev-token (hasło dowolne).
  Z kluczami (`SUPABASE_URL`+`SUPABASE_SERVICE_ROLE_KEY` w backend/.env): konta
  zakładane w Supabase (hasło `NovaMed.Test1`), ponowny bieg podmienia uid-y dev→Supabase.
  Demo-seed usunięty — wizyty/terminy/dokumenty tworzy się normalnie przez aplikację
  (rejestracja dodaje terminy w Panelu Poradni).
- **Słowniki ICD-10/leków**: `backend> .\.venv\Scripts\python.exe ..\scripts\import-dictionaries.py`
  (starter z `data/dictionaries/`; pełne oficjalne pliki: `--icd10 plik.csv`, `--rpl plik.csv` z RPL)
- **Makiety UI** (z `mockupy-ui/`): `npm run dev` → localhost:5173

## Konwencje

- Dokumentacja i komentarze domenowe po polsku; kod (nazwy, identyfikatory) po angielsku.
- Nazwy tabel/kolumn DB zgodne z ERD (`schemat danych`); zmiany schematu
  tylko przez migracje Alembic + wpis wmd jeśli odbiega od oryginalnego ERD.
- Statusy domenowe (wizyta, e-recepta, badanie lab) — zgodne z diagramami stanów.
