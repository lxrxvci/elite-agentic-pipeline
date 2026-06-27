"""S3-compatible object storage client for uploaded images."""

from __future__ import annotations

import uuid
from typing import Any, cast

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError

from app.config import settings

_ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
}

_MAX_UPLOAD_BYTES = settings.storage_max_upload_mb * 1024 * 1024


def _get_client() -> boto3.client | None:
    """Return an S3-compatible client if storage is configured."""
    if not all(
        [
            settings.storage_endpoint,
            settings.storage_bucket,
            settings.storage_access_key_id,
            settings.storage_secret_access_key,
        ]
    ):
        return None

    return boto3.client(
        "s3",
        endpoint_url=settings.storage_endpoint,
        aws_access_key_id=settings.storage_access_key_id,
        aws_secret_access_key=settings.storage_secret_access_key,
        region_name=settings.storage_region,
        config=BotoConfig(
            retries={"max_attempts": 3, "mode": "standard"},
            connect_timeout=5,
            read_timeout=10,
        ),
    )


def is_storage_configured() -> bool:
    """Return True when all required storage settings are present."""
    return _get_client() is not None


def generate_upload_key(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID | None,
    content_type: str,
) -> str:
    """Generate a tenant-prefixed object key for an upload."""
    ext = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/heic": "heic",
    }.get(content_type, "bin")
    site_part = str(site_id) if site_id else "onboarding"
    return f"{tenant_id}/{site_part}/{uuid.uuid4()}.{ext}"


def validate_upload_request(content_type: str, size_bytes: int) -> None:
    """Validate content type and size for an upload."""
    if content_type not in _ALLOWED_CONTENT_TYPES:
        raise ValueError(f"Content type '{content_type}' is not allowed")
    if size_bytes <= 0:
        raise ValueError("File size must be greater than 0")
    if size_bytes > _MAX_UPLOAD_BYTES:
        raise ValueError(
            f"File size exceeds maximum allowed {settings.storage_max_upload_mb} MB"
        )


def create_presigned_upload_url(
    storage_key: str,
    content_type: str,
    size_bytes: int,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a presigned URL for a direct upload to object storage.

    Returns a dict with upload_url, public_url, storage_key, and fields.
    """
    validate_upload_request(content_type, size_bytes)
    client = _get_client()
    if client is None:
        raise RuntimeError("Object storage is not configured")

    params: dict[str, Any] = {
        "Bucket": settings.storage_bucket,
        "Key": storage_key,
        "ContentType": content_type,
    }
    if metadata:
        params["Metadata"] = {k: str(v) for k, v in metadata.items()}

    try:
        response = client.generate_presigned_post(
            Bucket=settings.storage_bucket,
            Key=storage_key,
            Fields={"Content-Type": content_type},
            Conditions=[
                {"Content-Type": content_type},
                ["content-length-range", size_bytes, size_bytes],
            ],
            ExpiresIn=settings.storage_presigned_ttl_seconds,
        )
    except ClientError as exc:
        raise RuntimeError(f"Failed to generate presigned upload URL: {exc}") from exc

    public_url = settings.storage_public_url or settings.storage_endpoint
    return {
        "upload_url": response["url"],
        "fields": response["fields"],
        "storage_key": storage_key,
        "public_url": f"{public_url.rstrip('/')}/{storage_key}",
        "expires_in": settings.storage_presigned_ttl_seconds,
    }


def fetch_object(storage_key: str) -> bytes:
    """Fetch an object from storage as bytes."""
    client = _get_client()
    if client is None:
        raise RuntimeError("Object storage is not configured")
    try:
        response = client.get_object(Bucket=settings.storage_bucket, Key=storage_key)
        return cast(bytes, response["Body"].read())
    except ClientError as exc:
        raise RuntimeError(f"Failed to fetch object {storage_key}: {exc}") from exc


def delete_object(storage_key: str) -> bool:
    """Delete an object from storage. Returns True if deleted or not found."""
    client = _get_client()
    if client is None:
        return False
    try:
        client.delete_object(Bucket=settings.storage_bucket, Key=storage_key)
        return True
    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code", "Unknown")
        if error_code == "NoSuchKey":
            return True
        raise RuntimeError(f"Failed to delete object {storage_key}: {exc}") from exc
