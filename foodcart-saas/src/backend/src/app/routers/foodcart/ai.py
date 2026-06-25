"""Foodcart AI Website Assistant router."""

from __future__ import annotations

import hashlib
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies import CurrentUser, get_db, require_role
from app.exceptions import ConflictError, NotFoundError
from app.observability import get_logger
from app.schemas_foodcart import (
    AIApplyRequestSchema,
    AIProposeRequestSchema,
    AIProposeResponseSchema,
    PatchOperationSchema,
    RevisionSchema,
)
from domain.entities import AIRequest, AIRequestStatus, Revision, RevisionSource
from domain.services.foodcart import apply_patch_operations
from infrastructure.llm import LLMProvider
from infrastructure.repositories import (
    AIRequestRepository,
    ContentBlockRepository,
    RevisionRepository,
    SiteRepository,
)

router = APIRouter(tags=["AI Assistant"])
logger = get_logger(__name__)


def _get_llm_provider() -> LLMProvider:
    return LLMProvider(settings)


def _ensure_site_owned(site_id: uuid.UUID, tenant_id: uuid.UUID, db: Session) -> None:
    site = SiteRepository(db, tenant_id).get(site_id)
    if not site:
        raise NotFoundError("Site not found")


@router.post("/sites/{site_id}/ai/propose", response_model=AIProposeResponseSchema)
def propose_change(
    site_id: uuid.UUID,
    payload: AIProposeRequestSchema,
    user: CurrentUser = Depends(require_role("owner", "editor")),
    db: Session = Depends(get_db),
) -> AIProposeResponseSchema:
    _ensure_site_owned(site_id, user.tenant_id, db)
    blocks = ContentBlockRepository(db, user.tenant_id).list_for_site(site_id)
    provider = _get_llm_provider()
    preview = provider.generate_change_preview(
        prompt=payload.prompt,
        blocks=blocks,
        tenant_id=user.tenant_id,
        site_id=site_id,
    )

    ai_request = AIRequest(
        id=preview.proposal_id,
        tenant_id=user.tenant_id,
        site_id=site_id,
        user_id=user.id,
        prompt=payload.prompt,
        prompt_hash=hashlib.sha256(payload.prompt.encode("utf-8")).hexdigest(),
        model=provider.model_name,
        status=AIRequestStatus.PROPOSED if preview.in_scope else AIRequestStatus.FAILED,
        proposed_patch=[op.model_dump() for op in preview.operations],
    )
    AIRequestRepository(db, user.tenant_id).create(ai_request)
    db.commit()

    logger.info(
        "ai_propose",
        tenant_id=str(user.tenant_id),
        site_id=str(site_id),
        proposal_id=str(preview.proposal_id),
        in_scope=preview.in_scope,
        operation_count=len(preview.operations),
    )

    return AIProposeResponseSchema(
        proposal_id=preview.proposal_id,
        summary=preview.summary,
        in_scope=preview.in_scope,
        confidence=preview.confidence,
        operations=[PatchOperationSchema(**op.model_dump()) for op in preview.operations],
    )


@router.post("/sites/{site_id}/ai/apply", response_model=RevisionSchema)
def apply_change(
    site_id: uuid.UUID,
    payload: AIApplyRequestSchema,
    user: CurrentUser = Depends(require_role("owner", "editor")),
    db: Session = Depends(get_db),
) -> RevisionSchema:
    _ensure_site_owned(site_id, user.tenant_id, db)
    if not payload.confirmed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Confirmed must be true to apply the proposal",
        )

    ai_repo = AIRequestRepository(db, user.tenant_id)
    ai_request = ai_repo.get(payload.proposal_id)
    if not ai_request or ai_request.site_id != site_id:
        raise NotFoundError("Proposal not found")
    if ai_request.status != AIRequestStatus.PROPOSED:
        raise ConflictError("Proposal is not in a proposed state")

    block_repo = ContentBlockRepository(db, user.tenant_id)
    blocks = block_repo.list_for_site(site_id)

    # Snapshot before mutation.
    snapshot = {
        "blocks": [
            {
                "id": str(b.id),
                "block_type": b.block_type.value,
                "schema_version": b.schema_version,
                "data": b.data,
                "sort_order": b.sort_order,
            }
            for b in blocks
        ]
    }

    revision = Revision(
        id=uuid.uuid4(),
        site_id=site_id,
        tenant_id=user.tenant_id,
        triggered_by=user.id,
        source=RevisionSource.AI,
        ai_request_id=ai_request.id,
        snapshot=snapshot,
    )
    RevisionRepository(db, user.tenant_id).create(revision)

    # Apply allowlisted patch operations.
    apply_patch_operations(blocks, ai_request.proposed_patch)
    for block in blocks:
        block_repo.update(block)

    ai_request.status = AIRequestStatus.APPLIED
    ai_request.applied_revision_id = revision.id
    ai_repo.update(ai_request)

    db.commit()

    logger.info(
        "ai_apply",
        tenant_id=str(user.tenant_id),
        site_id=str(site_id),
        proposal_id=str(ai_request.id),
        revision_id=str(revision.id),
        user_id=str(user.id),
    )

    return RevisionSchema.model_validate(revision)
