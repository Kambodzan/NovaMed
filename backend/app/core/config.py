from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "NovaMed API"
    database_url: str = "***REMOVED***"

    # Supabase Auth — backend tylko weryfikuje tokeny (legacy HS256 JWT secret
    # z dashboardu: Settings → API → JWT Secret). Service role key używany
    # WYŁĄCZNIE przez scripts/provision-users.py (zakładanie kont testowych).
    supabase_url: str = ""
    supabase_jwt_secret: str = "dev-secret-do-podmiany"
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

    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:5174"]
    # dev: front otwierany z adresów LAN (testy z innych urządzeń w sieci lokalnej)
    cors_origin_regex: str = r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+$"

    # Pętla przypomnień o wizytach (UC-P7); wyłączana w testach
    reminders_enabled: bool = True
    reminders_interval_seconds: int = 600

    # Po ilu minutach porzucona płatność (TEMP_LOCK) zwalnia termin z powrotem do puli
    temp_lock_minutes: int = 15


settings = Settings()
