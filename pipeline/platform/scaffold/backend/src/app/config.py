"""Application configuration."""

from __future__ import annotations

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    env: str = "development"
    secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/elite_db"
    enabled_features: str = ""

    # Feature flag provider. Priority:
    # 1. Managed feature-flag endpoint (MANAGED_FEATURE_FLAGS_URL)
    # 2. Unleash (UNLEASH_URL)
    # 3. Comma-separated ENABLED_FEATURES env variable
    managed_feature_flags_url: str = ""
    managed_feature_flags_token: str = ""
    unleash_url: str = ""
    unleash_api_token: str = ""
    unleash_refresh_interval: int = 15
    unleash_app_name: str = "elite-backend"

    # Clerk OIDC/OAuth2 (production identity)
    clerk_jwks_url: str = ""
    clerk_audience: str = ""
    clerk_issuer: str = ""

    # Observability
    otel_exporter_otlp_endpoint: str = ""
    log_level: str = "info"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @model_validator(mode="after")
    def reject_default_secret_in_production(self) -> Settings:
        if self.env != "development" and self.secret_key in {
            "dev-secret-key-change-in-production",
            "change-me-in-production",
        }:
            raise ValueError(
                "SECRET_KEY must be changed from the default placeholder "
                "in non-development environments"
            )
        return self


# secret_key is loaded from environment; mypy cannot see the env source.
settings = Settings()  # type: ignore[call-arg]
