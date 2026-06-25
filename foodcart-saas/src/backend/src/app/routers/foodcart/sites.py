"""Foodcart site management router."""

from __future__ import annotations

import uuid
from typing import cast

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.dependencies import CurrentUser, get_current_user, get_db, require_role
from app.exceptions import ConflictError, NotFoundError
from app.schemas_foodcart import (
    ErrorSchema,
    SiteCreateSchema,
    SiteSchema,
    SiteUpdateSchema,
)
from domain.entities import Site, SitePublishState
from domain.services.foodcart import normalize_slug
from infrastructure import models
from infrastructure.repositories import SiteRepository

router = APIRouter(prefix="/sites", tags=["Sites"])


def _to_schema(site: models.Site | Site) -> SiteSchema:
    return SiteSchema.model_validate(site)


@router.get("", response_model=list[SiteSchema])
def list_sites(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[SiteSchema]:
    site_rows = SiteRepository(db, user.tenant_id).list()
    return [_to_schema(site_orm) for site_orm in site_rows]


@router.post("", response_model=SiteSchema, status_code=status.HTTP_201_CREATED)
def create_site(
    payload: SiteCreateSchema,
    user: CurrentUser = Depends(require_role("owner")),
    db: Session = Depends(get_db),
) -> SiteSchema:
    normalized_slug = normalize_slug(payload.slug)
    if SiteRepository(db, user.tenant_id).get_by_slug(normalized_slug):
        raise ConflictError("Slug is already taken")

    site = Site(
        id=uuid.uuid4(),
        tenant_id=user.tenant_id,
        slug=normalized_slug,
        template_id=payload.template_id,
        publish_state=SitePublishState.DRAFT,
        seo=payload.seo.model_dump() if payload.seo else {},
    )
    SiteRepository(db, user.tenant_id).create(site)
    db.commit()
    orm = (
        db.query(models.Site)
        .filter(models.Site.tenant_id == user.tenant_id)
        .filter(models.Site.id == site.id)
        .first()
    )
    return _to_schema(cast(models.Site, orm))


@router.get("/{site_id}", response_model=SiteSchema, responses={404: {"model": ErrorSchema}})
def get_site(
    site_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SiteSchema:
    site = SiteRepository(db, user.tenant_id).get(site_id)
    if not site:
        raise NotFoundError("Site not found")
    orm = (
        db.query(models.Site)
        .filter(models.Site.tenant_id == user.tenant_id)
        .filter(models.Site.id == site_id)
        .first()
    )
    return _to_schema(cast(models.Site, orm))


@router.patch("/{site_id}", response_model=SiteSchema, responses={404: {"model": ErrorSchema}})
def update_site(
    site_id: uuid.UUID,
    payload: SiteUpdateSchema,
    user: CurrentUser = Depends(require_role("owner")),
    db: Session = Depends(get_db),
) -> SiteSchema:
    repo = SiteRepository(db, user.tenant_id)
    site = repo.get(site_id)
    if not site:
        raise NotFoundError("Site not found")

    if payload.template_id:
        site.template_id = payload.template_id
    if payload.publish_state:
        site.publish_state = SitePublishState(payload.publish_state)
    if payload.seo is not None:
        site.seo = payload.seo.model_dump()
    if payload.custom_domain is not None:
        site.custom_domain = payload.custom_domain

    repo.update(site)
    db.commit()
    orm = (
        db.query(models.Site)
        .filter(models.Site.tenant_id == user.tenant_id)
        .filter(models.Site.id == site_id)
        .first()
    )
    return _to_schema(cast(models.Site, orm))


@router.delete("/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_site(
    site_id: uuid.UUID,
    user: CurrentUser = Depends(require_role("owner")),
    db: Session = Depends(get_db),
) -> None:
    repo = SiteRepository(db, user.tenant_id)
    site = repo.get(site_id)
    if not site:
        raise NotFoundError("Site not found")
    # Related content/revisions/jobs cascade via FK relationships configured in the
    # repository delete; SQLAlchemy cascade deletes cover the rest.
    repo.delete(site_id)
    db.commit()
