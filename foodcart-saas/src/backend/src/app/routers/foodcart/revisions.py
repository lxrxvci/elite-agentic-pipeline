"""Foodcart revision history router."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.dependencies import CurrentUser, get_current_user, get_db, require_role
from app.exceptions import NotFoundError
from app.schemas_foodcart import RevisionSchema
from domain.entities import ContentBlock, ContentBlockType, Revision, RevisionSource
from infrastructure.repositories import (
    ContentBlockRepository,
    RevisionRepository,
    SiteRepository,
)

router = APIRouter(tags=["Revisions"])


def _ensure_site_owned(site_id: uuid.UUID, tenant_id: uuid.UUID, db: Session) -> None:
    site = SiteRepository(db, tenant_id).get(site_id)
    if not site:
        raise NotFoundError("Site not found")


@router.get("/sites/{site_id}/revisions", response_model=list[RevisionSchema])
def list_revisions(
    site_id: uuid.UUID,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[RevisionSchema]:
    _ensure_site_owned(site_id, user.tenant_id, db)
    revisions = RevisionRepository(db, user.tenant_id).list_for_site(
        site_id, limit=limit, offset=offset
    )
    return [RevisionSchema.model_validate(r) for r in revisions]


@router.post(
    "/sites/{site_id}/revisions/{revision_id}/revert",
    response_model=RevisionSchema,
)
def revert_revision(
    site_id: uuid.UUID,
    revision_id: uuid.UUID,
    user: CurrentUser = Depends(require_role("owner", "editor")),
    db: Session = Depends(get_db),
) -> RevisionSchema:
    _ensure_site_owned(site_id, user.tenant_id, db)
    revision_repo = RevisionRepository(db, user.tenant_id)
    target = revision_repo.get(revision_id, site_id=site_id)
    if not target:
        raise NotFoundError("Revision not found")

    block_repo = ContentBlockRepository(db, user.tenant_id)
    current_blocks = block_repo.list_for_site(site_id)

    before_snapshot = {
        "blocks": [
            {
                "id": str(b.id),
                "block_type": b.block_type.value,
                "schema_version": b.schema_version,
                "data": b.data,
                "sort_order": b.sort_order,
            }
            for b in current_blocks
        ]
    }

    revert_revision_obj = Revision(
        id=uuid.uuid4(),
        site_id=site_id,
        tenant_id=user.tenant_id,
        triggered_by=user.id,
        source=RevisionSource.REVERT,
        snapshot=before_snapshot,
    )
    revision_repo.create(revert_revision_obj)

    restored_blocks: list[ContentBlock] = []
    for raw in target.snapshot.get("blocks", []):
        restored_blocks.append(
            ContentBlock(
                id=uuid.UUID(raw["id"]),
                site_id=site_id,
                tenant_id=user.tenant_id,
                block_type=ContentBlockType(raw["block_type"]),
                schema_version=raw["schema_version"],
                data=raw["data"],
                sort_order=raw["sort_order"],
            )
        )
    block_repo.replace_for_site(site_id, restored_blocks)

    db.commit()
    return RevisionSchema.model_validate(revert_revision_obj)
