"""Upload presigned URL router for Foodcart SaaS."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.dependencies import CurrentUser, get_db, require_role
from app.features import is_feature_enabled
from app.schemas_foodcart import ErrorSchema
from domain.entities import UploadedImage
from infrastructure import storage
from infrastructure.repositories import UploadedImageRepository

router = APIRouter(prefix="/uploads", tags=["Uploads"])


class PresignedUploadRequest(BaseModel):
    content_type: str = Field(..., pattern=r"^image/(jpeg|png|webp|heic)$")
    size_bytes: int = Field(..., ge=1, le=10 * 1024 * 1024)
    site_id: uuid.UUID | None = None


class PresignedUploadResponse(BaseModel):
    upload_url: str
    fields: dict[str, str]
    storage_key: str
    public_url: str
    image_id: uuid.UUID
    expires_in: int


@router.post(
    "/presigned",
    response_model=PresignedUploadResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        400: {"model": ErrorSchema},
        403: {"model": ErrorSchema},
        503: {"model": ErrorSchema},
    },
)
def create_presigned_upload(
    payload: PresignedUploadRequest,
    user: CurrentUser = Depends(require_role("owner", "editor")),
    db: Session = Depends(get_db),
) -> PresignedUploadResponse:
    if not is_feature_enabled("photo-onboarding-v1"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Photo onboarding is not enabled",
        )

    if not storage.is_storage_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Object storage is not configured",
        )

    try:
        storage.validate_upload_request(payload.content_type, payload.size_bytes)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    storage_key = storage.generate_upload_key(
        tenant_id=user.tenant_id,
        site_id=payload.site_id,
        content_type=payload.content_type,
    )

    try:
        presigned = storage.create_presigned_upload_url(
            storage_key=storage_key,
            content_type=payload.content_type,
            size_bytes=payload.size_bytes,
            metadata={"tenant_id": str(user.tenant_id)},
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    image = UploadedImage(
        id=uuid.uuid4(),
        tenant_id=user.tenant_id,
        site_id=payload.site_id,
        storage_key=storage_key,
        public_url=presigned["public_url"],
        content_type=payload.content_type,
        size_bytes=payload.size_bytes,
        status="uploaded",
        metadata={"source": "onboarding"},
    )
    UploadedImageRepository(db, user.tenant_id).create(image)

    return PresignedUploadResponse(
        upload_url=presigned["upload_url"],
        fields=presigned["fields"],
        storage_key=storage_key,
        public_url=presigned["public_url"],
        image_id=image.id,
        expires_in=presigned["expires_in"],
    )
