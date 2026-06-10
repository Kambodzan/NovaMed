from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "NovaMed API"
    database_url: str = "***REMOVED***"

    # Supabase Auth — backend tylko weryfikuje tokeny (legacy HS256 JWT secret
    # z dashboardu: Settings → API → JWT Secret)
    supabase_url: str = ""
    supabase_jwt_secret: str = "dev-secret-do-podmiany"
    supabase_jwt_aud: str = "authenticated"

    # Mock-serwisy integracji (mocks/) — podmiana na realne systemy przez env
    p1_base_url: str = "http://localhost:8101"
    zus_base_url: str = "http://localhost:8102"


settings = Settings()
