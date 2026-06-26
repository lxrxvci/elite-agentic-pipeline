"""Foodcart onboarding router."""

from __future__ import annotations

import uuid
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.dependencies import CurrentUser, get_current_user, get_db, require_role
from app.exceptions import ConflictError
from app.schemas_foodcart import (
    ErrorSchema,
    SiteSchema,
    SlugCheckRequest,
    SlugCheckResponse,
    TenantOnboardingRequestSchema,
    TenantOnboardingResponseSchema,
    TenantSchema,
)
from domain.entities import (
    IngestionJob,
    IngestionJobStatus,
    IngestionSourceType,
)
from domain.services.foodcart import (
    build_onboarding_result,
    default_blocks_for_template,
    merge_ingestion_into_blocks,
    normalize_slug,
    run_ingestion_job,
    suggest_slugs,
)
from infrastructure import models
from infrastructure.repositories import (
    ContentBlockRepository,
    FoodcartTenantRepository,
    IngestionJobRepository,
    SiteRepository,
)

router = APIRouter(prefix="/tenants", tags=["Onboarding"])


def _to_tenant_schema(orm: models.FoodcartTenant) -> TenantSchema:
    return TenantSchema.model_validate(orm)


def _to_site_schema(orm: models.Site) -> SiteSchema:
    return SiteSchema.model_validate(orm)


@router.post(
    "/slug/check",
    response_model=SlugCheckResponse,
    status_code=status.HTTP_200_OK,
)
def check_slug(
    payload: SlugCheckRequest,
    db: Session = Depends(get_db),
) -> SlugCheckResponse:
    normalized = normalize_slug(payload.slug)
    existing = (
        db.query(models.FoodcartTenant.slug)
        .filter(models.FoodcartTenant.slug == normalized)
        .first()
    )
    taken = {row[0] for row in db.query(models.FoodcartTenant.slug).all()}
    available = existing is None and normalized not in {"admin", "api", "www"}
    return SlugCheckResponse(
        slug=payload.slug,
        available=available,
        normalized_slug=normalized,
        suggestions=suggest_slugs(normalized, taken) if not available else [],
    )


@router.post(
    "/onboard",
    response_model=TenantOnboardingResponseSchema,
    status_code=status.HTTP_201_CREATED,
)
def onboard_tenant(
    payload: TenantOnboardingRequestSchema,
    user: CurrentUser = Depends(require_role("owner")),
    db: Session = Depends(get_db),
) -> TenantOnboardingResponseSchema:
    tenant_repo = FoodcartTenantRepository(db, user.tenant_id)
    if tenant_repo.get():
        raise ConflictError("Tenant already onboarded")

    normalized_slug = normalize_slug(payload.slug)
    if FoodcartTenantRepository(db, user.tenant_id).get_by_slug(normalized_slug):
        raise ConflictError("Slug is already taken")

    tenant, site = build_onboarding_result(
        user_id=user.id,
        tenant_id=user.tenant_id,
        business_name=payload.business_name,
        slug=normalized_slug,
        template_id=payload.template_id,
        brand_colors=payload.brand_colors.model_dump(),
    )
    tenant_repo.create(tenant)

    site_repo = SiteRepository(db, user.tenant_id)
    site_repo.create(site)

    blocks = default_blocks_for_template(
        template_id=payload.template_id,
        business_name=payload.business_name,
        site_id=site.id,
        tenant_id=user.tenant_id,
    )

    ingestion_jobs: list[IngestionJob] = []
    if payload.initial_sources:
        sources = payload.initial_sources
        job_repo = IngestionJobRepository(db, user.tenant_id)
        for source_type, url in [
            (IngestionSourceType.GOOGLE_BUSINESS, sources.google_business_url),
            (IngestionSourceType.YELP, sources.yelp_url),
            (IngestionSourceType.MENU_URL, sources.menu_url),
            (IngestionSourceType.WEBSITE, sources.website_url),
        ]:
            if url:
                job = IngestionJob(
                    id=uuid.uuid4(),
                    site_id=site.id,
                    tenant_id=user.tenant_id,
                    source_type=source_type,
                    source_url=url,
                    status=IngestionJobStatus.PENDING,
                )
                job_repo.create(job)
                ingestion_jobs.append(job)

        if sources.social_links or sources.order_links:
            links_payload = {
                "links": [
                    {"platform": link.platform, "url": link.url}
                    for link in (sources.social_links or [])
                ]
                + [
                    {"platform": link.platform, "url": link.url}
                    for link in (sources.order_links or [])
                ]
            }
            job = IngestionJob(
                id=uuid.uuid4(),
                site_id=site.id,
                tenant_id=user.tenant_id,
                source_type=IngestionSourceType.SOCIAL_LINKS,
                source_url="manual-links",
                status=IngestionJobStatus.PENDING,
                raw_payload=links_payload,
            )
            job_repo.create(job)
            ingestion_jobs.append(job)

    for job in ingestion_jobs:
        run_ingestion_job(job)
        job_repo.update(job)
        if job.normalized_data:
            blocks = merge_ingestion_into_blocks(blocks, job.normalized_data)

    block_repo = ContentBlockRepository(db, user.tenant_id)
    for block in blocks:
        block_repo.create(block)

    db.commit()
    tenant_orm = (
        db.query(models.FoodcartTenant)
        .filter(models.FoodcartTenant.id == tenant.id)
        .first()
    )
    site_orm = (
        db.query(models.Site)
        .filter(models.Site.id == site.id)
        .first()
    )
    return TenantOnboardingResponseSchema(
        tenant=_to_tenant_schema(cast(models.FoodcartTenant, tenant_orm)),
        site=_to_site_schema(cast(models.Site, site_orm)),
    )


@router.get("/me", response_model=dict[str, Any], responses={401: {"model": ErrorSchema}})
def get_current_tenant(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    tenant = FoodcartTenantRepository(db, user.tenant_id).get()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found",
        )
    orm = (
        db.query(models.FoodcartTenant)
        .filter(models.FoodcartTenant.id == user.tenant_id)
        .first()
    )
    return _to_tenant_schema(cast(models.FoodcartTenant, orm)).model_dump()
