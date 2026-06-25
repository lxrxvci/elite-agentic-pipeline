"""Foodcart content block router."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy.orm import Session

from app.dependencies import CurrentUser, get_current_user, get_db, require_role
from app.exceptions import NotFoundError
from app.schemas_foodcart import ContentBlockCreateSchema, ContentBlockSchema
from domain.entities import ContentBlock, ContentBlockType
from domain.services.foodcart import validate_block_data
from infrastructure.repositories import ContentBlockRepository, SiteRepository

router = APIRouter(tags=["Content"])


def _ensure_site_owned(site_id: uuid.UUID, tenant_id: uuid.UUID, db: Session) -> None:
    site = SiteRepository(db, tenant_id).get(site_id)
    if not site:
        raise NotFoundError("Site not found")


@router.get("/sites/{site_id}/content", response_model=dict)
def get_content(
    site_id: uuid.UUID,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    _ensure_site_owned(site_id, user.tenant_id, db)
    blocks = ContentBlockRepository(db, user.tenant_id).list_for_site(site_id)
    return {
        "site_id": site_id,
        "blocks": [ContentBlockSchema.model_validate(b) for b in blocks],
    }


@router.post(
    "/sites/{site_id}/content/blocks",
    response_model=ContentBlockSchema,
    status_code=status.HTTP_201_CREATED,
)
def add_block(
    site_id: uuid.UUID,
    payload: ContentBlockCreateSchema,
    user: CurrentUser = Depends(require_role("owner", "editor")),
    db: Session = Depends(get_db),
) -> ContentBlockSchema:
    _ensure_site_owned(site_id, user.tenant_id, db)
    try:
        data = validate_block_data(payload.block_type, payload.data)
    except (PydanticValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    block = ContentBlock(
        id=uuid.uuid4(),
        site_id=site_id,
        tenant_id=user.tenant_id,
        block_type=ContentBlockType(payload.block_type),
        schema_version=payload.schema_version,
        data=data,
        sort_order=payload.sort_order,
    )
    created = ContentBlockRepository(db, user.tenant_id).create(block)
    db.commit()
    return ContentBlockSchema.model_validate(created)


@router.put("/sites/{site_id}/content/blocks/{block_id}", response_model=ContentBlockSchema)
def update_block(
    site_id: uuid.UUID,
    block_id: uuid.UUID,
    payload: ContentBlockCreateSchema,
    user: CurrentUser = Depends(require_role("owner", "editor")),
    db: Session = Depends(get_db),
) -> ContentBlockSchema:
    _ensure_site_owned(site_id, user.tenant_id, db)
    repo = ContentBlockRepository(db, user.tenant_id)
    existing = repo.get(block_id, site_id=site_id)
    if not existing:
        raise NotFoundError("Content block not found")
    try:
        data = validate_block_data(payload.block_type, payload.data)
    except (PydanticValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    updated_block = ContentBlock(
        id=block_id,
        site_id=site_id,
        tenant_id=user.tenant_id,
        block_type=ContentBlockType(payload.block_type),
        schema_version=payload.schema_version,
        data=data,
        sort_order=payload.sort_order,
    )
    updated = repo.update(updated_block)
    db.commit()
    return ContentBlockSchema.model_validate(updated)


@router.delete(
    "/sites/{site_id}/content/blocks/{block_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_block(
    site_id: uuid.UUID,
    block_id: uuid.UUID,
    user: CurrentUser = Depends(require_role("owner", "editor")),
    db: Session = Depends(get_db),
) -> None:
    _ensure_site_owned(site_id, user.tenant_id, db)
    repo = ContentBlockRepository(db, user.tenant_id)
    existing = repo.get(block_id, site_id=site_id)
    if not existing:
        raise NotFoundError("Content block not found")
    repo.delete(block_id)
    db.commit()
