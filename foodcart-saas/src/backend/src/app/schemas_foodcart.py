"""Pydantic request/response schemas for the Foodcart SaaS API."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from domain.services.foodcart import is_valid_slug, normalize_slug


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


class SocialLinkSchema(BaseModel):
    platform: str = Field(
        ...,
        pattern=r"^(google|yelp|instagram|facebook|tiktok|website)$",
    )
    url: str


class OrderLinkSchema(BaseModel):
    platform: str = Field(
        ...,
        pattern=r"^(doordash|ubereats|grubhub|website|phone)$",
    )
    url: str


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
