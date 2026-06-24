# NovaMed — wdrożenie na VPS od A do Z (publiczny URL, jeden serwer)

Turnkey: świeży VPS → działający `https://twoja-domena` z całym stosem (backend + 5 mocków
integracji + Postgres + frontend) za reverse-proxy Caddy z automatycznym TLS. Supabase Auth
zostaje w chmurze. Architektura/zmienne w szczegółach: `docs/WDROZENIE.md`.

> Idź po kolei. Każdy krok ma komendy do wklejenia. Tam, gdzie coś łatwo przeoczyć, jest **⚠️**.

---

## 0. Czego potrzebujesz (zbierz to najpierw)
- **VPS** Ubuntu 22.04+/Debian 12, **min. 2 GB RAM, zalecane 4 GB** (~10 kontenerów). Tanio: Hetzner CX22, Mikr.us, DigitalOcean.
- **Domena** (lub darmowa subdomena DuckDNS) — ustawisz rekord **A → IP VPS**. ⚠️ Bez domeny nie ma ważnego TLS, a telemedycyna/kamera wymaga HTTPS.
- **Projekt Supabase** (Auth). ⚠️ **MUSI używać kluczy asymetrycznych ES256** (nowe projekty mają to domyślnie). Sprawdź: Supabase → Project Settings → **JWT Keys / Signing Keys** — ma być widoczny aktywny klucz **ECC (ES256)** i endpoint JWKS. Jeśli projekt jest stary (tylko „Legacy JWT Secret” HS256) → włącz/zmigruj do asymetrycznych. **W produkcji backend akceptuje wyłącznie ES256 z JWKS — token HS256 zostanie odrzucony i logowanie nie zadziała.**

Z dashboardu Supabase (Project Settings → API) wypisz 4 rzeczy: **Project URL**, **anon public key**,
**service_role key**, oraz **JWT Secret** (Legacy; w prod służy tylko do spełnienia guardu, patrz krok 4).

---

## 1. Wgranie kodu na VPS

Repo jest **lokalne, bez remote'a** — najpierw zacommituj i wypchnij. ⚠️ **Praca (zestaw deploy/, dokumentacja) jest niezacommitowana** — bez commita nie ma czego sklonować.

**Opcja A — prywatne repo Git (zalecane):**
```bash
# NA SWOIM KOMPUTERZE (Windows), w katalogu repo:
git add -A && git commit -m "Deploy: zestaw wdrozeniowy VPS + dokumentacja"
# załóż PRYWATNE repo na GitHub/GitLab, potem:
git remote add origin git@github.com:TWOJ_LOGIN/novamed.git
git push -u origin main
```
```bash
# NA VPS:
git clone git@github.com:TWOJ_LOGIN/novamed.git novamed && cd novamed
```

**Opcja B — bez serwera Git (czysty tarball + scp):**
```bash
# NA WINDOWS (PowerShell), w katalogu repo — najpierw commit (jak wyżej), potem:
git archive --format=tar.gz -o ..\novamed.tar.gz HEAD     # tylko śledzone pliki, bez .git/.venv/node_modules/.env
scp ..\novamed.tar.gz root@IP_VPS:/root/
ssh root@IP_VPS "mkdir -p novamed && tar -xzf novamed.tar.gz -C novamed"
```
> ⚠️ `git archive HEAD` bierze tylko **zacommitowane** pliki — dlatego commit jest konieczny w obu opcjach.
> `.env`, `.venv`, `node_modules`, `.git` i tak są pomijane (gitignore) — to dobrze, mają się nie wgrać.

---

## 2. VPS: połączenie, firewall, Docker
```bash
ssh root@IP_VPS          # (lub ssh uzytkownik@IP_VPS)
```
⚠️ **Firewall providera/chmury:** w panelu VPS (Security Groups / Cloud Firewall) otwórz porty **22, 80, 443**.
Na samym serwerze (jeśli ufw jest aktywny — najpierw SSH, żeby się nie odciąć):
```bash
sudo ufw allow 22,80,443/tcp 2>/dev/null || true
```
Docker + plugin compose:
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker     # (opcjonalnie: docker bez sudo)
docker compose version
```

---

## 3. DNS
Ustaw rekord **A**: `twoja-domena` → `IP_VPS` (DuckDNS: wpisz IP w panelu). Sprawdź propagację:
```bash
dig +short twoja-domena      # ma zwrócić IP VPS-a
```
⚠️ Caddy wyda certyfikat dopiero, gdy domena realnie wskazuje na VPS i port 80 jest otwarty.

---

## 4. Konfiguracja
```bash
cd ~/novamed
cp deploy/.env.prod.example deploy/.env
bash deploy/gen-keys.sh        # wypisze POSTGRES_PASSWORD + DATA_ENCRYPTION_KEY + DATA_INDEX_KEY
nano deploy/.env               # wklej wygenerowane + uzupełnij DOMAIN i Supabase
```
W `deploy/.env` ustaw: `DOMAIN`, `POSTGRES_PASSWORD`, `DATA_ENCRYPTION_KEY`, `DATA_INDEX_KEY`,
`SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`.

> ⚠️ **Co robi `SUPABASE_JWT_SECRET` w prod:** weryfikacja tokenów idzie przez **ES256/JWKS** (z `SUPABASE_URL`),
> a nie przez ten sekret. Guard produkcyjny i tak wymaga, by był ustawiony (≠ domyślny) — wpisz prawdziwy
> Legacy JWT Secret z dashboardu. To `SUPABASE_URL` + ES256 w projekcie decydują o tym, czy logowanie działa.

**Supabase → Authentication → URL Configuration:** dodaj `https://twoja-domena` jako **Site URL**
i do **Redirect URLs** (inaczej reset hasła / linki nie wrócą na właściwy adres).

---

## 5. Start
```bash
cd ~/novamed/deploy
docker compose -f docker-compose.prod.yml up -d --build
```
Pierwszy build to kilka minut. Kolejność: `db` → `init` (migracje + konta + słowniki) →
`backend` + mocki + `frontend` → `caddy` (pobiera TLS). Podgląd:
```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f init      # czy migracje/seed przeszły bez błędu
docker compose -f docker-compose.prod.yml logs -f caddy     # czy wydał certyfikat (szukaj "certificate obtained")
```

---

## 6. Gotowe — zaloguj się
Wejdź na **`https://twoja-domena`**. Konta startowe (utworzone przez `init` w Supabase), hasło **`NovaMed.Test1`**:

| Rola | E-mail |
|---|---|
| Administrator | `a.kowalczyk@novamed.dev` |
| Lekarz | `p.zielinski@novamed.dev` |
| Rejestracja / Poradnia | `janina.wisniewska@novamed.dev` |
| Pacjent | `tomasz.borkowski@novamed.dev` |

(pełna lista ról i kont: `scripts/provision-users.py`). Szybki test API: `https://twoja-domena/api/health` → `{"status":"ok"}`.

---

## 7. Aktualizacja / redeploy
```bash
cd ~/novamed && git pull        # (opcja B: wgraj nowy tarball)
cd deploy && docker compose -f docker-compose.prod.yml up -d --build
# 'init' uruchamia migracje ponownie (idempotentnie) przy każdym starcie
```

## 8. Backup bazy
```bash
docker compose -f docker-compose.prod.yml exec db pg_dump -U novamed -Fc novamed > novamed_$(date +%F).dump
```
Restore i HA: `docs/BACKUP_HA.md`.

---

## 9. Najczęstsze problemy
- **Logowanie nie działa, „401/Invalid algorithm”, choć hasło dobre** → projekt Supabase NIE używa ES256
  (token HS256 odrzucany w prod). Włącz klucze asymetryczne w Supabase (krok 0) albo sprawdź, czy `SUPABASE_URL`
  jest poprawny (z niego backend pobiera JWKS). `docker compose logs backend`.
- **Brak certyfikatu / „TLS handshake error”** → DNS nie wskazuje na VPS lub port 80/443 zamknięty (firewall
  providera!). `dig +short twoja-domena`, panel chmury, `docker compose logs caddy`.
- **`backend` w pętli restartów** → guard prod: brakuje `SUPABASE_JWT_SECRET` (≠ domyślny), `SUPABASE_URL`,
  `DATA_ENCRYPTION_KEY`/`DATA_INDEX_KEY` albo `PUBLIC_BASE_URL` to localhost. Sprawdź `deploy/.env`.
- **`init` padł na kontach** → zły `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_URL`. Popraw `.env` i
  `docker compose -f docker-compose.prod.yml up -d --build init`, potem `... up -d`.
- **Logowanie/reset wraca na zły adres** → dodaj domenę w Supabase → Auth → URL Configuration (krok 4).
- **Mało RAM / OOM-kill** → w `.env` ustaw `WEB_CONCURRENCY=1`; backend i Postgres ważą najwięcej, mocki są lekkie.
- **`git clone` na VPS prosi o hasło / odmawia** → repo prywatne wymaga klucza SSH (dodaj klucz VPS-a do GitHub) lub użyj opcji B (tarball).

## 10. Uwaga o integracjach
P1, eWUŚ, ZUS e-ZLA, laboratorium, płatności, SMS działają jako **mock-serwisy** — realne wymagają
umów/certyfikatów/statusu podmiotu leczniczego (poza zakresem pracy inż.). Wyjście na realne = zmiana
`*_BASE_URL`/`SMS_PROVIDER` w env, bez zmian w kodzie (`docs/WDROZENIE.md` §5).
