from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import AnyHttpUrl
from typing import List


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    APP_NAME: str = "PulseGuest"
    ENV: str = "dev"
    DEBUG: bool = True

    CORS_ORIGINS: str = "http://localhost:5173"  # comma-separated

    DATABASE_URL: str

    JWT_ISSUER: str = "pulseguest"
    JWT_ACCESS_TTL_SECONDS: int = 900
    JWT_REFRESH_TTL_SECONDS: int = 1209600
    JWT_SECRET: str

    STORE_IP: bool = False

    AUDIT_UPLOAD_DIR: str = "media/audit"

    # Public frontend base URL for QR codes / deep links.
    PUBLIC_BASE_URL: str = ""

    # --- Password reset / email notifications ---
    # Redis is used for one-time reset tokens and cooldowns.
    REDIS_URL: str = "redis://redis:6379/0"

    # Base URL of the admin frontend (used to build password reset links).
    # If empty, we fallback to PUBLIC_BASE_URL or the first CORS origin.
    FRONTEND_BASE_URL: str = ""

    PASSWORD_RESET_TOKEN_TTL_SECONDS: int = 3600  # 60 minutes
    PASSWORD_RESET_COOLDOWN_SECONDS: int = 60

    # Extra throttling (best-effort). Helps against spraying many emails/tokens from one IP.
    PASSWORD_RESET_IP_COOLDOWN_SECONDS: int = 10
    PASSWORD_RESET_CONFIRM_COOLDOWN_SECONDS: int = 2

    NEGATIVE_NOTIFY_COOLDOWN_SECONDS: int = 20

    # SMTP (will be reused later for notifications about negative feedback).
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASS: str = ""
    SMTP_FROM: str = ""
    SMTP_TLS: bool = True
    SMTP_SSL: bool = False

    def cors_list(self) -> List[str]:
        return [x.strip() for x in self.CORS_ORIGINS.split(",") if x.strip()]


settings = Settings()  # type: ignore
