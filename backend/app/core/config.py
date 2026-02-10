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

    def cors_list(self) -> List[str]:
        return [x.strip() for x in self.CORS_ORIGINS.split(",") if x.strip()]


settings = Settings()  # type: ignore
