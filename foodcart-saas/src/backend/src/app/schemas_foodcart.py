"""Pydantic request/response schemas for the Foodcart SaaS API."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from domain.services.foodcart import is_valid_slug, normalize_slug

_ALLOWED_URL_SCHEMES = {"https", "mailto", "tel"}


def validate_url_scheme(url: str) -> str:
    """Allow only https, mailto, and tel schemes in user-provided URLs."""
    if not url:
        return url
    scheme = url.split(":", 1)[0].lower()
    if scheme not in _ALLOWED_URL_SCHEMES:
        raise ValueError(f"URL scheme '{scheme}' is not allowed; use https, mailto, or tel")
    return url


class SlugCheckRequest(BaseModel):
    slug: str = Field(..., min_length=1, max_length=63, pattern=r"^[a-z0-9-]+$")

    @field_validator("slug")
    @classmethod
    def validate_slug_characters(cls, v: str) -> str:
        normalized = normalize_slug(v)
        if not normalized or normalized != v:
            raise ValueError("Slug must be lowercase letters, numbers, and hyphens only")
        return normalized


class SlugCheckResponse(BaseModel):
    slug: str
    available: bool
    normalized_slug: str
    suggestions: list[str] = []


class SeoMetaSchema(BaseModel):
    title: str | None = None
    description: str | None = None
    favicon_url: str | None = None

    @field_validator("favicon_url")
    @classmethod
    def validate_favicon_url(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return validate_url_scheme(v)


class BrandColorsSchema(BaseModel):
    primary: str = Field(..., pattern=r"^#[0-9a-fA-F]{6}$")
    secondary: str = Field(..., pattern=r"^#[0-9a-fA-F]{6}$")
    background: str = Field(..., pattern=r"^#[0-9a-fA-F]{6}$")


class TenantSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str
    status: str
    billing_status: str
    plan: str
    billing_interval: str | None = None
    subscription_status: str | None = None
    subscription_current_period_start: datetime | None = None
    subscription_current_period_end: datetime | None = None
    trial_ends_at: datetime | None = None
    canceled_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class SiteSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    slug: str
    template_id: str
    publish_state: str
    seo: dict[str, Any] | None = None
    brand_colors: BrandColorsSchema | None = None
    custom_domain: str | None = None
    domain_status: str | None = None
    domain_provider: str | None = None
    created_at: datetime
    updated_at: datetime


class SiteCreateSchema(BaseModel):
    slug: str = Field(..., min_length=1, max_length=63, pattern=r"^[a-z0-9-]+$")
    template_id: str = Field("custom", pattern=r"^(banhmi|real-indian|mis-abuelos|custom)$")
    seo: SeoMetaSchema | None = None
    brand_colors: BrandColorsSchema | None = None

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: str) -> str:
        normalized = normalize_slug(v)
        if not is_valid_slug(normalized):
            raise ValueError("Slug is invalid or reserved")
        return normalized


class SiteUpdateSchema(BaseModel):
    template_id: str | None = Field(None, pattern=r"^(banhmi|real-indian|mis-abuelos|custom)$")
    publish_state: str | None = Field(None, pattern=r"^(draft|published)$")
    seo: SeoMetaSchema | None = None
    brand_colors: BrandColorsSchema | None = None
    custom_domain: str | None = Field(None, max_length=255)


class ConnectDomainRequestSchema(BaseModel):
    domain: str = Field(..., min_length=3, max_length=255)
    provider: str = Field("external", pattern=r"^(external|cloudflare|namecheap)$")


class DomainStatusResponseSchema(BaseModel):
    domain: str
    status: str  # 'pending' | 'active' | 'error'
    provider: str | None = None
    dns_verified: bool
    dns_message: str | None = None


class DomainAvailabilitySchema(BaseModel):
    name: str
    registrable: bool
    currency: str
    registration_cost: str
    renewal_cost: str
    reason: str | None = None


class DomainSearchResponseSchema(BaseModel):
    query: str
    domains: list[DomainAvailabilitySchema]


class DomainPurchaseRequestSchema(BaseModel):
    domain: str = Field(..., min_length=3, max_length=255)


class DomainPurchaseResponseSchema(BaseModel):
    checkout_url: str
    domain: str
    total: str
    currency: str


class ContentBlockSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    site_id: UUID
    tenant_id: UUID
    block_type: str
    schema_version: str
    data: dict[str, Any]
    sort_order: int
    created_at: datetime
    updated_at: datetime


class ContentBlockCreateSchema(BaseModel):
    block_type: str = Field(
        ...,
        pattern=r"^(hero|story|menu|locations|catering|contact|order_links|footer)$",
    )
    schema_version: str = Field(default="1.0")
    data: dict[str, Any]
    sort_order: int = 0

    @field_validator("data")
    @classmethod
    def validate_data_urls(cls, v: dict[str, Any]) -> dict[str, Any]:
        """Validate known URL fields inside block data."""
        url_keys = {"cta_url", "map_url", "favicon_url", "url"}

        def _check_value(value: Any) -> None:
            if isinstance(value, str):
                validate_url_scheme(value)
            elif isinstance(value, list):
                for item in value:
                    _check_value(item)
            elif isinstance(value, dict):
                for key, item in value.items():
                    if key in url_keys or key.endswith("_url"):
                        _check_value(item)
                    elif isinstance(item, (dict, list)):
                        _check_value(item)

        _check_value(v)
        return v


class SocialLinkSchema(BaseModel):
    platform: str = Field(
        ...,
        pattern=r"^(google|yelp|instagram|facebook|tiktok|website)$",
    )
    url: str

    @field_validator("url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        return validate_url_scheme(v)


class OrderLinkSchema(BaseModel):
    platform: str = Field(
        ...,
        pattern=r"^(doordash|ubereats|grubhub|website|phone)$",
    )
    url: str

    @field_validator("url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        return validate_url_scheme(v)


class IngestionRequestSchema(BaseModel):
    google_business_url: str | None = None
    yelp_url: str | None = None
    menu_url: str | None = None
    website_url: str | None = None
    social_links: list[SocialLinkSchema] | None = None
    order_links: list[OrderLinkSchema] | None = None


class IngestionJobSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    site_id: UUID
    source_type: str
    source_url: str
    status: str
    normalized_data: dict[str, Any] | None = None
    errors: list[str]
    created_at: datetime


class IngestionJobDetailSchema(IngestionJobSchema):
    raw_payload: dict[str, Any] | None = None
    proposed_blocks: list[dict[str, Any]]


class PatchOperationSchema(BaseModel):
    op: str = Field(..., pattern=r"^(add|replace|remove)$")
    path: str
    value: Any = None


class AIProposeRequestSchema(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2000)


class AIProposeResponseSchema(BaseModel):
    proposal_id: UUID
    summary: str
    in_scope: bool
    confidence: float
    operations: list[PatchOperationSchema]


class AIApplyRequestSchema(BaseModel):
    proposal_id: UUID
    confirmed: bool


class RevisionSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    site_id: UUID
    triggered_by: UUID
    source: str
    ai_request_id: UUID | None = None
    snapshot: dict[str, Any]
    created_at: datetime


class PublicSiteSchema(BaseModel):
    slug: str
    template_id: str
    publish_state: str
    seo: dict[str, Any] | None = None
    brand_colors: BrandColorsSchema | None = None
    blocks: list[ContentBlockSchema]


class TenantOnboardingRequestSchema(BaseModel):
    business_name: str = Field(..., min_length=1, max_length=255)
    slug: str = Field(..., min_length=1, max_length=63, pattern=r"^[a-z0-9-]+$")
    template_id: str = Field("custom", pattern=r"^(banhmi|real-indian|mis-abuelos|custom)$")
    brand_colors: BrandColorsSchema
    initial_sources: IngestionRequestSchema | None = None

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: str) -> str:
        normalized = normalize_slug(v)
        if not is_valid_slug(normalized):
            raise ValueError("Slug is invalid or reserved")
        return normalized


class TenantOnboardingResponseSchema(BaseModel):
    tenant: TenantSchema
    site: SiteSchema


class ErrorSchema(BaseModel):
    detail: str


class BillingInterval(StrEnum):
    month = "month"
    year = "year"


class PlanSchema(BaseModel):
    id: str
    name: str
    interval: BillingInterval
    price_usd: str


class BillingPlansResponse(BaseModel):
    monthly: PlanSchema
    yearly: PlanSchema


class CheckoutRequest(BaseModel):
    interval: BillingInterval


class CheckoutResponse(BaseModel):
    checkout_url: str


class PortalResponse(BaseModel):
    url: str


class SubscriptionResponse(BaseModel):
    plan: str
    status: str | None
    billing_interval: str | None
    current_period_start: datetime | None
    current_period_end: datetime | None
    trial_ends_at: datetime | None
    canceled_at: datetime | None
    paddle_subscription_id: str | None
    paddle_customer_id: str | None
