"""Foodcart ingestion router."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.dependencies import CurrentUser, get_current_user, get_db, require_role
from app.exceptions import NotFoundError
from app.schemas_foodcart import (
    IngestionJobDetailSchema,
    IngestionJobSchema,
    IngestionRequestSchema,
)
from domain.entities import IngestionJob, IngestionJobStatus, IngestionSourceType
from domain.services.foodcart import run_ingestion_job
from infrastructure import models
from infrastructure.repositories import IngestionJobRepository, SiteRepository

router = APIRouter(tags=["Ingestion"])


def _ensure_site_owned(site_id: uuid.UUID, tenant_id: uuid.UUID, db: Session) -> None:
    site = SiteRepository(db, tenant_id).get(site_id)
    if not site:
        raise NotFoundError("Site not found")


@router.post(
    "/sites/{site_id}/ingest",
    response_model=list[IngestionJobSchema],
    status_code=status.HTTP_202_ACCEPTED,
)
def trigger_ingestion(
    site_id: uuid.UUID,
    payload: IngestionRequestSchema,
    user: CurrentUser = Depends(require_role("owner", "editor")),
    db: Session = Depends(get_db),
) -> list[IngestionJobSchema]:
    _ensure_site_owned(site_id, user.tenant_id, db)
    repo = IngestionJobRepository(db, user.tenant_id)
    jobs: list[IngestionJob] = []

    for source_type, url in [
        (IngestionSourceType.GOOGLE_BUSINESS, payload.google_business_url),
        (IngestionSourceType.YELP, payload.yelp_url),
        (IngestionSourceType.MENU_URL, payload.menu_url),
        (IngestionSourceType.WEBSITE, payload.website_url),
    ]:
        if url:
            job = IngestionJob(
                id=uuid.uuid4(),
                site_id=site_id,
                tenant_id=user.tenant_id,
                source_type=source_type,
                source_url=url,
                status=IngestionJobStatus.PENDING,
            )
            repo.create(job)
            jobs.append(job)

    social_order_links: list[dict[str, str]] = []
    for social_link in payload.social_links or []:
        social_order_links.append({"platform": social_link.platform, "url": social_link.url})
    for order_link in payload.order_links or []:
        social_order_links.append({"platform": order_link.platform, "url": order_link.url})

    if social_order_links:
        job = IngestionJob(
            id=uuid.uuid4(),
            site_id=site_id,
            tenant_id=user.tenant_id,
            source_type=IngestionSourceType.SOCIAL_LINKS,
            source_url="manual-links",
            status=IngestionJobStatus.PENDING,
            raw_payload={"links": social_order_links},
        )
        repo.create(job)
        jobs.append(job)

    for job in jobs:
        run_ingestion_job(job)
        repo.update(job)

    db.commit()
    return [
        IngestionJobSchema.model_validate(
            db.query(models.IngestionJob).filter(models.IngestionJob.id == job.id).first()
        )
        for job in jobs
    ]


@router.get("/sites/{site_id}/ingest/jobs", response_model=list[IngestionJobSchema])
def list_jobs(
    site_id: uuid.UUID,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[IngestionJobSchema]:
    _ensure_site_owned(site_id, user.tenant_id, db)
    jobs = IngestionJobRepository(db, user.tenant_id).list_for_site(
        site_id, limit=limit, offset=offset
    )
    return [IngestionJobSchema.model_validate(j) for j in jobs]


@router.get(
    "/sites/{site_id}/ingest/jobs/{job_id}",
    response_model=IngestionJobDetailSchema,
)
def get_job(
    site_id: uuid.UUID,
    job_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> IngestionJobDetailSchema:
    _ensure_site_owned(site_id, user.tenant_id, db)
    job = IngestionJobRepository(db, user.tenant_id).get(job_id, site_id=site_id)
    if not job:
        raise NotFoundError("Ingestion job not found")
    orm = (
        db.query(models.IngestionJob)
        .filter(models.IngestionJob.tenant_id == user.tenant_id)
        .filter(models.IngestionJob.id == job_id)
        .first()
    )
    return IngestionJobDetailSchema.model_validate(orm)
