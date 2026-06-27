"""Foodcart onboarding router."""

from __future__ import annotations

import uuid
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.dependencies import CurrentUser, get_current_user, get_db, require_role
from app.exceptions import ConflictError
from app.features import PHOTO_ONBOARDING_FLAG, is_feature_enabled
from app.observability import get_logger, get_metrics_provider
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
    ContentBlock,
    IngestionJob,
    IngestionJobStatus,
    IngestionSourceType,
    UploadedImage,
)
from domain.services.foodcart import (
    build_onboarding_result,
    default_blocks_for_template,
    merge_ingestion_into_blocks,
    normalize_slug,
    run_ingestion_job,
    suggest_slugs,
)
from infrastructure import models, storage
from infrastructure.repositories import (
    ContentBlockRepository,
    FoodcartTenantRepository,
    IngestionJobRepository,
    SiteRepository,
    UploadedImageRepository,
)

logger = get_logger(__name__)

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


def _load_and_validate_photo(
    db: Session,
    tenant_id: uuid.UUID,
    photo_image_id: uuid.UUID | None,
) -> UploadedImage | None:
    """Return the uploaded photo if it exists, is owned, and is ready for onboarding."""
    if not photo_image_id:
        return None

    if not is_feature_enabled(PHOTO_ONBOARDING_FLAG):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Photo-driven onboarding is not enabled",
        )

    image = UploadedImageRepository(db, tenant_id).get(photo_image_id)
    if not image:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded image not found",
        )
    if image.status != "uploaded":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Uploaded image is not available for onboarding (status: {image.status})",
        )
    return image


def _enrich_from_photo(
    db: Session,
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    image: UploadedImage,
    blocks: list[ContentBlock],
) -> None:
    """Run vision + Places enrichment and use the photo as the hero image.

    On any failure the image is marked ``failed`` but onboarding continues.
    """
    metrics = get_metrics_provider()
    image_repo = UploadedImageRepository(db, tenant_id)
    image.site_id = site_id
    image.status = "processing"
    image_repo.update(image)

    logger.info(
        "photo_enrichment_started",
        tenant_id=str(tenant_id),
        site_id=str(site_id),
        image_id=str(image.id),
    )

    try:
        if not storage.is_storage_configured():
            raise RuntimeError("Object storage is not configured")

        job_repo = IngestionJobRepository(db, tenant_id)
        vision_job = IngestionJob(
            id=uuid.uuid4(),
            site_id=site_id,
            tenant_id=tenant_id,
            source_type=IngestionSourceType.PHOTO_VISION,
            source_url=image.storage_key,
            status=IngestionJobStatus.PENDING,
            raw_payload={"storage_key": image.storage_key, "mime_type": image.content_type},
        )
        job_repo.create(vision_job)
        run_ingestion_job(vision_job)
        job_repo.update(vision_job)
        if vision_job.normalized_data:
            merge_ingestion_into_blocks(blocks, vision_job.normalized_data)

        vision_data = vision_job.normalized_data or {}
        business_name = vision_data.get("business_name")
        if business_name:
            places_job = IngestionJob(
                id=uuid.uuid4(),
                site_id=site_id,
                tenant_id=tenant_id,
                source_type=IngestionSourceType.GOOGLE_PLACES,
                source_url=business_name,
                status=IngestionJobStatus.PENDING,
                raw_payload={
                    "business_name": business_name,
                    "location_hints": vision_data.get("location_hints"),
                },
            )
            job_repo.create(places_job)
            run_ingestion_job(places_job)
            job_repo.update(places_job)
            if places_job.normalized_data:
                merge_ingestion_into_blocks(blocks, places_job.normalized_data)

        for block in blocks:
            if block.block_type.value == "hero" and image.public_url:
                block.data["image_url"] = image.public_url

        image.status = "processed"
        logger.info(
            "photo_enrichment_succeeded",
            tenant_id=str(tenant_id),
            site_id=str(site_id),
            image_id=str(image.id),
        )
        metrics.observe_photo_enrichment(status="success")
    except Exception as exc:
        logger.warning(
            "photo_enrichment_failed",
            error_type=type(exc).__name__,
            error=str(exc),
            tenant_id=str(tenant_id),
            site_id=str(site_id),
            image_id=str(image.id),
        )
        metrics.observe_photo_enrichment(status="failed")
        image.status = "failed"
    finally:
        image_repo.update(image)


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

    photo_image = _load_and_validate_photo(db, user.tenant_id, payload.photo_image_id)

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

    if photo_image is not None:
        _enrich_from_photo(db, user.tenant_id, site.id, photo_image, blocks)

    metrics = get_metrics_provider()
    photo_enabled = is_feature_enabled(PHOTO_ONBOARDING_FLAG)
    photo_used = (
        "uploaded"
        if photo_image is not None
        else ("skipped" if photo_enabled else "none")
    )
    metrics.observe_onboarding_completion(
        photo_enabled=str(photo_enabled),
        photo_used=photo_used,
        tenant_id=str(user.tenant_id),
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
