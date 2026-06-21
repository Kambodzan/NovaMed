from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_JWT_SECRET = "dev-secret-do-podmiany"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "NovaMed API"
    database_url: str = "***REMOVED***"
    # bazowy URL frontendu — do linków w SMS (np. potwierdzenie wizyty z linka).
    # Na razie sztywno na adres LAN; w produkcji domena z env.
    public_base_url: str = "https://192.168.111.201:5174"

    # Tryb deweloperski: login bez hasła (/auth/dev-token), fallback HS256 i luźny
    # CORS dla LAN. W PRODUKCJI ustaw DEV_MODE=false — wtedy akceptowane są
    # wyłącznie tokeny ES256 z JWKS Supabase (nie da się podrobić tokenu sekretem).
    dev_mode: bool = True

    # Supabase Auth — backend tylko weryfikuje tokeny (legacy HS256 JWT secret
    # z dashboardu: Settings → API → JWT Secret). Service role key używany
    # WYŁĄCZNIE przez scripts/provision-users.py (zakładanie kont testowych).
    supabase_url: str = ""
    supabase_jwt_secret: str = DEFAULT_JWT_SECRET
    supabase_jwt_aud: str = "authenticated"
    supabase_service_role_key: str = ""

    # Mock-serwisy integracji (mocks/) — podmiana na realne systemy przez env.
    # 127.0.0.1 zamiast localhost: na Windows localhost próbuje najpierw IPv6 (::1),
    # a uvicorn słucha na IPv4 — kosztowało to ~1 s na każde wywołanie.
    p1_base_url: str = "http://127.0.0.1:8101"
    zus_base_url: str = "http://127.0.0.1:8102"
    ewus_base_url: str = "http://127.0.0.1:8103"
    lab_base_url: str = "http://127.0.0.1:8104"
    payments_base_url: str = "http://127.0.0.1:8105"
    sms_base_url: str = "http://127.0.0.1:8106"
    sms_enabled: bool = True
    # Dostawca SMS: "mock" (mock-serwis :8106) albo "twilio" (realna dostawa).
    # Twilio: konto trial wystarcza (SMS tylko na zweryfikowane numery). Sekrety w .env.
    sms_provider: str = "mock"
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from: str = ""          # numer nadawcy z Twilio, E.164 (np. +1...)
    sms_default_country: str = "48"  # domyślny kierunkowy dla numerów bez „+"
    # DEV: przekieruj WSZYSTKIE SMS na jeden numer testowy (np. autora) — żeby realny
    # SMS dotarł niezależnie od numeru wpisanego w formularzu (Twilio trial dostarcza
    # tylko na zweryfikowane numery). Pusty = brak przekierowania. E.164, np. +48500000000.
    sms_redirect_to: str = ""
    # E-mail (powiadomienia/potwierdzenia). "mock" = log+outbox (dev), "smtp" = realna dostawa.
    email_provider: str = "mock"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""          # nadawca, np. "NovaMed <noreply@novamed.dev>"
    email_redirect_to: str = ""  # DEV: przekieruj wszystkie maile na ten adres (jak sms_redirect_to)

    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:5174"]
    # dev: front otwierany z adresów LAN (testy z innych urządzeń w sieci lokalnej)
    cors_origin_regex: str = r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+$"

    # Pętla przypomnień o wizytach (UC-P7); wyłączana w testach
    reminders_enabled: bool = True
    reminders_interval_seconds: int = 600

    # Po ilu minutach porzucona płatność (TEMP_LOCK) zwalnia termin z powrotem do puli
    temp_lock_minutes: int = 15
    # Po ilu minutach „hold" terminu (otwarty formularz rezerwacji, jeszcze bez
    # płatności) wygasa i termin wraca do puli — krócej niż okno płatności
    slot_hold_minutes: int = 10

    @model_validator(mode="after")
    def _production_guards(self):
        """Twardy fail przy starcie produkcyjnym z niebezpieczną konfiguracją —
        żeby aplikacja nie ruszyła z domyślnym sekretem (podrabialne tokeny)."""
        if not self.dev_mode:
            if self.supabase_jwt_secret == DEFAULT_JWT_SECRET:
                raise ValueError("Produkcja (DEV_MODE=false) wymaga ustawienia własnego SUPABASE_JWT_SECRET.")
            if not self.supabase_url:
                raise ValueError("Produkcja (DEV_MODE=false) wymaga SUPABASE_URL.")
        return self


settings = Settings()
