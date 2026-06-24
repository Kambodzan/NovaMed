#!/usr/bin/env bash
# Generuje sekrety do deploy/.env: dwa klucze szyfrowania (32B base64) + haslo bazy.
# Uzycie:  bash deploy/gen-keys.sh
set -euo pipefail
gen32() { python3 -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"; }
genpw() { python3 -c "import secrets;print(secrets.token_urlsafe(24))"; }
echo "# wklej do deploy/.env:"
echo "POSTGRES_PASSWORD=$(genpw)"
echo "DATA_ENCRYPTION_KEY=$(gen32)"
echo "DATA_INDEX_KEY=$(gen32)"
echo
echo "# (DATA_* zapisz w bezpiecznym miejscu — po starcie NIE zmieniaj, bo nie odszyfrujesz danych)"
