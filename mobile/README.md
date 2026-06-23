# NovaMed — aplikacja mobilna pacjenta (Expo / React Native)

Aplikacja pacjenta skupiona na **ogólnym rezerwowaniu wizyt** i zarządzaniu nimi.
Spójna z portalem webowym (te samo API, ten sam design system — `system designu`).

## Zakres (MVP mobilne)

- **Logowanie** — Supabase Auth (e-mail + hasło) lub tryb dev-token (sam e-mail).
- **Umów wizytę** — wybór placówki → lekarza i wolnego terminu → potwierdzenie
  (powód, teleporada gdy dozwolona, NFZ / płatność online / na miejscu, skierowanie, faktura).
- **Płatność** — symulacja bramki (mock operatora): opłać / odmowa / rezygnacja.
- **Moje wizyty** — nadchodzące i historia; potwierdzenie obecności, przełożenie, odwołanie,
  dokończenie płatności.
- **Dokumenty** — recepty/skierowania/wyniki/zwolnienia/zaświadczenia, podgląd, pobranie PDF.
- **Pulpit / Powiadomienia / Udostępnianie kodem / Konta rodzinne / Teleporada (gość).**
- **Profil** — dane pacjenta, status ubezpieczenia (eWUŚ), wylogowanie.
- **Push** — powiadomienia na urządzenie (Expo Push); **tryb offline** — podgląd ostatnio
  pobranych danych bez sieci (persystowany cache).

## Uruchomienie

```bash
cd mobile
cp .env.example .env.local        # i uzupełnij (patrz niżej)
npm install --legacy-peer-deps    # SDK 56 + React 19
npx expo start                    # następnie: skan QR w Expo Go / „a" (Android) / „i" (iOS)
```

## Konfiguracja (`.env.local`)

- `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` — logowanie przez Supabase
  (klucz anon jest publiczny). Bez nich aplikacja przełącza się na tryb dev-token.
- `EXPO_PUBLIC_API_URL` — adres backendu, np. `http://192.168.1.10:8000`.

### Ważne: backend po HTTP do testów mobilnych

Backend dev działa po **HTTPS z certyfikatem self-signed**, którego React Native nie
zaakceptuje na urządzeniu. Do testów mobilnych uruchom API po HTTP i wskaż je w `.env.local`:

```bash
# z katalogu backend/
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
# w mobile/.env.local:
EXPO_PUBLIC_API_URL=http://<IP-maszyny-w-LAN>:8000
```

Telefon i komputer muszą być w tej samej sieci; wymagana reguła firewalla na port 8000.

## Konta testowe

`janina.wisniewska@novamed.dev` / `tomasz.borkowski@novamed.dev` — hasło `NovaMed.Test1`
(Supabase) lub dowolne (tryb dev-token). Na ekranie logowania dostępne jako kafelki
jednodotykowego logowania.

## Powiadomienia push (Expo)

Apka rejestruje token push urządzenia w backendzie po zalogowaniu (`src/lib/push.ts`
→ `POST /notifications/push-token`) i zdejmuje go przy wylogowaniu. Powiadomienia
domenowe (potwierdzenie/zmiana wizyty, nowy dokument, wolny termin…) idą tym samym
lejem `notify()` co in-app/SMS/e-mail — dochodzi kanał **push** na zarejestrowane
urządzenia (Expo Push API). Tapnięcie w powiadomienie otwiera listę powiadomień.

> **Wymóg dev-buildu**: od Expo SDK 53 **zdalny push nie działa w Expo Go** — potrzebny
> jest development build (`npx expo run:android` / `eas build --profile development`).
> W Expo Go kod rejestracji wykona się best-effort i po prostu pominie push (apka działa
> normalnie). Na **web** push nie jest obsługiwany (wszystkie funkcje to no-op).

## Tryb offline

Cache TanStack Query jest **persystowany do AsyncStorage** (`PersistQueryClientProvider`,
`gcTime` 24 h), więc po ponownym otwarciu / bez sieci ostatnio pobrane dane (wizyty,
dokumenty, pulpit) pokazują się od razu. Stan sieci śledzi NetInfo (natywnie) /
`navigator.onLine` (web); offline → bursztynowy pasek „Tryb offline — pokazujemy
ostatnio pobrane dane" i brak ponawiania zapytań w nieskończoność.

## Architektura

- **expo-router** (file-based), **TanStack Query** + persystencja (cache offline), **AsyncStorage** (sesja).
- `src/lib/` — `api` (klient REST + Bearer), `auth` (dwa tryby + rejestracja push), `push`,
  `supabase`, `family`, `types`, `theme`, `format`, `download[.native]`.
- `src/components/ui.tsx` — wspólne komponenty (jedyne źródło stylów wg wspólnego systemu designu).
- `app/` — ekrany: `login`, `(tabs)/{index,umow,wizyty,dokumenty,profil}` (własny pasek z
  centralnym CTA „Umów"), `booking/{[clinicId],confirm}`, `notifications`, `udostepnij`.
