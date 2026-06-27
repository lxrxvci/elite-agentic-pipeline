"""Application configuration."""

from __future__ import annotations

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    env: str = "development"
    secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    database_url: str
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
    otel_exporter_otlp_headers: str = ""
    otel_service_name: str = "elite-backend"
    otel_resource_attributes: str = ""
    log_level: str = "info"

    # Redis is required for multi-process rate limiting and quotas.
    # Falls back to in-memory storage when not configured.
    redis_url: str = ""

    # Per-tenant mutation quota. In-memory by default; use Redis for multi-process.
    tenant_quota_limit: int = 100
    tenant_quota_window: int = 60

    # LLM provider configuration.
    # Priority: Bedrock (when enabled) > Gemini (when API key set) > deterministic stub.
    # AWS credentials are loaded from the environment/IMDS; no API key is required here.
    bedrock_enabled: bool = False
    bedrock_region: str = "us-east-1"
    bedrock_model_id: str = "anthropic.claude-3-5-sonnet-20241022-v2:0"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"

    # Paddle Billing configuration
    paddle_api_key: str = ""
    paddle_environment: str = "sandbox"  # 'sandbox' | 'production'
    paddle_webhook_secret: str = ""
    paddle_price_monthly_id: str = ""
    paddle_price_yearly_id: str = ""
    paddle_success_url: str = "http://localhost:3000/billing?success=1"
    paddle_cancel_url: str = "http://localhost:3000/billing?canceled=1"
    paddle_domain_product_id: str = ""  # Paddle product used for one-time domain purchases

    # Custom domain configuration
    platform_domain: str = ""  # e.g. "agenticpnw.com" for CNAME validation
    platform_host_ip: str = ""  # e.g. "76.76.21.21" for A-record validation
    domain_dns_validation_enabled: bool = True
    domain_markup_cents: int = 0  # Optional platform markup on registrar cost
    domain_purchase_success_url: str = "http://localhost:3000/settings/domain?purchase=success"
    domain_purchase_cancel_url: str = "http://localhost:3000/settings/domain?purchase=canceled"

    # Cloudflare Registrar API (beta) configuration
    cloudflare_api_token: str = ""
    cloudflare_account_id: str = ""
    cloudflare_registrar_enabled: bool = False

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

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

    @model_validator(mode="after")
    def require_clerk_in_production(self) -> Settings:
        if self.env == "production" and not self.clerk_jwks_url:
            raise ValueError("CLERK_JWKS_URL is required in production")
        return self

    @model_validator(mode="after")
    def reject_default_database_credentials(self) -> Settings:
        if "postgres:postgres@" in self.database_url:
            raise ValueError(
                "DATABASE_URL contains default credentials; "
                "set a real database URL via environment"
            )
        return self


# secret_key is loaded from environment; mypy cannot see the env source.
settings = Settings()  # type: ignore[call-arg]
