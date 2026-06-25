"""Clerk JWT validation helpers.

This module validates Bearer tokens issued by Clerk. It fetches Clerk's JWKS
once and caches it for the process lifetime, which is appropriate for
long-running containers and Vercel serverless functions.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import jwt
from jwt import PyJWKClient

from app.config import settings
from app.observability import get_logger

logger = get_logger(__name__)


class ClerkAuthError(Exception):
    """Raised when a Clerk token cannot be validated."""


_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client  # noqa: PLW0603
    if _jwks_client is None:
        if not settings.clerk_jwks_url:
            msg = "CLERK_JWKS_URL is not configured"
            raise ClerkAuthError(msg)
        _jwks_client = PyJWKClient(
            settings.clerk_jwks_url,
            cache_jwk_set=True,
            lifespan=3600,
        )
    return _jwks_client


def _fallback_fetch_jwks() -> dict[str, Any]:
    """Fetch the raw JWKS when PyJWKClient fails to parse the endpoint."""
    if not settings.clerk_jwks_url:
        msg = "CLERK_JWKS_URL is not configured"
        raise ClerkAuthError(msg)
    try:
        response = httpx.get(settings.clerk_jwks_url, timeout=10)
        response.raise_for_status()
        return response.json()  # type: ignore[no-any-return]
    except httpx.HTTPError as exc:
        raise ClerkAuthError("Failed to fetch Clerk JWKS") from exc


def _get_signing_key(token: str) -> jwt.PyJWK:
    try:
        return _get_jwks_client().get_signing_key_from_jwt(token)
    except jwt.PyJWKClientError as exc:
        logger.warning("PyJWKClient failed, falling back to manual JWKS fetch", error=str(exc))
        try:
            jwks = _fallback_fetch_jwks()
            unverified_header = jwt.get_unverified_header(token)
        except jwt.InvalidTokenError as header_exc:
            raise ClerkAuthError(f"Invalid token: {header_exc}") from header_exc
        except httpx.HTTPError as http_exc:
            raise ClerkAuthError("Unable to load Clerk signing key") from http_exc
        kid = unverified_header.get("kid")
        for key in jwks.get("keys", []):
            if key.get("kid") == kid:
                return jwt.PyJWK(key)
        raise ClerkAuthError("No matching signing key found in Clerk JWKS") from exc


def validate_clerk_token(token: str) -> dict[str, Any]:
    """Validate a Clerk-issued JWT and return its claims.

    Raises ClerkAuthError if the token is invalid, expired, or unusable.
    """
    try:
        signing_key = _get_signing_key(token)
    except ClerkAuthError:
        raise
    except Exception as exc:
        raise ClerkAuthError("Unable to load Clerk signing key") from exc

    audience = settings.clerk_audience or None
    issuer = settings.clerk_issuer or None

    try:
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=audience,
            issuer=issuer,
            options={"require": ["exp", "sub"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise ClerkAuthError("Token has expired") from exc
    except jwt.InvalidTokenError as exc:
        raise ClerkAuthError(f"Invalid token: {exc}") from exc


def claims_to_user_kwargs(claims: dict[str, Any]) -> dict[str, Any]:
    """Map Clerk token claims to CurrentUser-compatible kwargs.

    Clerk does not natively expose a tenant_id. We treat the user's ``sub`` as
    a stable identifier and map it to a deterministic tenant UUID so that a
    Clerk user always lands in the same tenant. In production you may prefer
    to synchronize Clerk organizations to tenants via a custom JWT claim.
    """
    sub = claims.get("sub")
    if not sub:
        raise ClerkAuthError("Token is missing 'sub' claim")

    email = claims.get("email", "")
    name = claims.get("name") or claims.get("username") or email.split("@")[0] or "Unknown"
    tenant_id = uuid.uuid5(uuid.NAMESPACE_URL, f"clerk://user/{sub}")
    user_id = uuid.uuid5(uuid.NAMESPACE_URL, f"clerk://user/{sub}")

    return {
        "id": user_id,
        "email": email,
        "name": name,
        "tenant_id": tenant_id,
        "clerk_id": sub,
    }


def create_dev_access_token(
    user_id: uuid.UUID,
    email: str,
    name: str,
    tenant_id: uuid.UUID,
) -> str:
    """Create a local development JWT compatible with the legacy auth path."""
    to_encode: dict[str, Any] = {
        "sub": str(user_id),
        "email": email,
        "name": name,
        "tenant_id": str(tenant_id),
    }
    expire = datetime.now(UTC) + timedelta(minutes=settings.access_token_expire_minutes)
    to_encode["exp"] = expire
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)
