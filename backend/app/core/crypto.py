# Szyfrowanie danych wrażliwych „at rest" (NFR M10): treść dokumentacji medycznej,
# noty lekarskie, wyniki, dane kliniczne i PESEL są szyfrowane PRZED zapisem do bazy
# i odszyfrowywane przy odczycie — transparentnie, przez typ kolumny SQLAlchemy.
#
# Algorytm: **AES-256-GCM** (AEAD — poufność + integralność; wykrywa manipulację
# szyfrogramem). Losowy 96-bitowy nonce per wartość, doklejony do szyfrogramu.
# Klucz 32 B z konfiguracji (`DATA_ENCRYPTION_KEY`, base64); w produkcji wymagany,
# w dev pochodna deterministyczna (działa bez setupu, NIE do produkcji).
#
# PESEL jest równościowo wyszukiwany (dedup/rejestracja, integracje) — szyfrogram
# z losowym nonce nie nadaje się do `WHERE`. Dlatego obok szyfrowanego PESEL-u trzymamy
# **blind index**: `pesel_bidx = HMAC-SHA256(klucz_indeksu, znormalizowany PESEL)` —
# deterministyczny, indeksowalny, nieodwracalny. Lookup idzie po HMAC, integracje po
# odszyfrowanym PESEL-u.
import base64
import hashlib
import hmac
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator

from app.core.config import settings

_PREFIX = "enc:v1:"  # marker wersji formatu (ułatwia rotację/migrację)
_NONCE_LEN = 12


def _enc_key() -> bytes:
    raw = settings.data_encryption_key
    if raw:
        key = base64.b64decode(raw)
        if len(key) != 32:
            raise RuntimeError("DATA_ENCRYPTION_KEY musi być 32-bajtowym kluczem w base64 (AES-256).")
        return key
    # DEV: deterministyczny klucz z sekretu JWT — spójny między restartami, ale jawnie
    # niesekretny. Produkcja (DEV_MODE=false) wymaga własnego klucza (guard w config).
    return hashlib.sha256(b"novamed-dev-data-key::" + settings.supabase_jwt_secret.encode()).digest()


def _index_key() -> bytes:
    raw = settings.data_index_key
    if raw:
        return base64.b64decode(raw)
    return hashlib.sha256(b"novamed-dev-index-key::" + settings.supabase_jwt_secret.encode()).digest()


def encrypt(plaintext: str) -> str:
    """Szyfruje tekst → 'enc:v1:<base64(nonce||ciphertext||tag)>'."""
    nonce = os.urandom(_NONCE_LEN)
    ct = AESGCM(_enc_key()).encrypt(nonce, plaintext.encode("utf-8"), None)
    return _PREFIX + base64.b64encode(nonce + ct).decode("ascii")


def decrypt(token: str) -> str:
    """Odszyfrowuje token. Wartość bez markera traktujemy jako legacy-plaintext
    (tolerancja przejściowa — pozwala czytać dane sprzed włączenia szyfrowania)."""
    if not token.startswith(_PREFIX):
        return token
    raw = base64.b64decode(token[len(_PREFIX):])
    nonce, ct = raw[:_NONCE_LEN], raw[_NONCE_LEN:]
    return AESGCM(_enc_key()).decrypt(nonce, ct, None).decode("utf-8")


def blind_index(value: str) -> str:
    """Deterministyczny, indeksowalny skrót do wyszukiwania równościowego (HMAC-SHA256)."""
    return hmac.new(_index_key(), value.strip().encode("utf-8"), hashlib.sha256).hexdigest()


class Encrypted(TypeDecorator):
    """Kolumna szyfrowana AES-256-GCM at-rest. W modelu używa się jak zwykłego String/Text;
    szyfrowanie/odszyfrowanie dzieje się transparentnie na zapisie/odczycie."""

    impl = Text  # szyfrogram base64 jako tekst (bez limitu długości)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # zapis → szyfr
        if value is None:
            return None
        return encrypt(value)

    def process_result_value(self, value, dialect):  # odczyt → jawne
        if value is None:
            return None
        return decrypt(value)
