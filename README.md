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
pigułkowe przyciski, Plus Jakarta Sans, primary teal #0D9488 (jeden, bez akcentów per rola),
siatka bento na dashboardach (sama składa się na mobile), soft chipy statusów.
**Zasada nadrzędna: restraint** — max 1 akcja primary + 1 secondary na kafel, dashboard 4–5
kafli, listy skrócone + „Wszystkie". WCAG AA, microcopy po polsku. Implementacja referencyjna:
`mockupy-ui/src/{index.css,ui.tsx}`. Nie wymyślamy stylów per ekran — tylko tokeny ze wspólnym systemem designu.

## Konwencje

- Dokumentacja i komentarze domenowe po polsku; kod (nazwy, identyfikatory) po angielsku.
- Nazwy tabel/kolumn DB zgodne z ERD (`schemat danych`); zmiany schematu
  tylko przez migracje Alembic + wpis wmd jeśli odbiega od oryginalnego ERD.
- Statusy domenowe (wizyta, e-recepta, badanie lab) — zgodne z diagramami stanów.
