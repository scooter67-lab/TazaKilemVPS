from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    """development | production — в production включаются проверки безопасности."""
    environment: str = "development"

    database_url: str = "sqlite:///./app.db"
    secret_key: str = "change_me"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 480
    refresh_token_expire_days: int = 7

    """
    Разрешённые origin для браузера (CORS).
    Значение "*" — только для разработки; в production укажите домены фронта через запятую.
    """
    cors_origins: str = "*"

    """
    Если true: при старте, если логин admin не принимает пароль admin123, пароль будет сброшен.
    В production по умолчанию false — задайте true один раз при «потерянном» пароле, затем уберите.
    """
    reset_admin_password: bool = False

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() == "production"

    def cors_allow_origins(self) -> list[str]:
        raw = self.cors_origins.strip()
        if raw == "*":
            return ["*"]
        parts = [p.strip() for p in raw.split(",") if p.strip()]
        return parts if parts else ["*"]


settings = Settings()
