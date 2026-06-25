"""Public site rendering router."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies import get_db
from app.exceptions import NotFoundError
from app.schemas_foodcart import ContentBlockSchema, PublicSiteSchema
from domain.services.foodcart import verify_preview_token
from infrastructure import models

router = APIRouter(prefix="/public", tags=["Public"])


def _site_to_public_schema(
    site_orm: models.Site, blocks_orm: list[models.ContentBlock]
) -> PublicSiteSchema:
    return PublicSiteSchema(
        slug=site_orm.slug,
        template_id=site_orm.template_id,
        publish_state=site_orm.publish_state,
        seo=site_orm.seo or {},
        blocks=[ContentBlockSchema.model_validate(b) for b in blocks_orm],
    )


@router.get("/sites/{slug}", response_model=PublicSiteSchema)
def get_public_site(
    slug: str,
    db: Session = Depends(get_db),
) -> PublicSiteSchema:
    site_orm = (
        db.query(models.Site).filter(models.Site.slug == slug).first()
    )
    if not site_orm or site_orm.publish_state != "published":
        raise NotFoundError("Site not found")
    blocks_orm = (
        db.query(models.ContentBlock)
        .filter(models.ContentBlock.site_id == site_orm.id)
        .order_by(models.ContentBlock.sort_order.asc())
        .all()
    )
    return _site_to_public_schema(site_orm, blocks_orm)


@router.get("/sites/{slug}/preview", response_model=PublicSiteSchema)
def preview_site(
    slug: str,
    preview_token: str = Query(...),
    db: Session = Depends(get_db),
) -> PublicSiteSchema:
    site_orm = (
        db.query(models.Site).filter(models.Site.slug == slug).first()
    )
    if not site_orm:
        raise NotFoundError("Site not found")
    if not verify_preview_token(
        preview_token, uuid.UUID(str(site_orm.id)), settings.secret_key
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired preview token",
        )
    blocks_orm = (
        db.query(models.ContentBlock)
        .filter(models.ContentBlock.site_id == site_orm.id)
        .order_by(models.ContentBlock.sort_order.asc())
        .all()
    )
    return _site_to_public_schema(site_orm, blocks_orm)
