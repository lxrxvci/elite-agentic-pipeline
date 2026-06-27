"""FastAPI dependencies for auth, database, tenant isolation, and quotas."""

from __future__ import annotations

import threading
import time
import uuid
from collections import defaultdict
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel
from redis import Redis
from sqlalchemy.orm import Session

from app.audit import log_security_event
from app.auth.clerk import ClerkAuthError, validate_clerk_token
from app.config import settings
from app.features import is_feature_enabled
from infrastructure.database import get_db
from infrastructure.models import FoodcartTenant as FoodcartTenantORM
from infrastructure.models import Tenant as TenantORM
from infrastructure.models import User as UserORM

_redis_client: Redis | None = None
_redis_lock = threading.Lock()


def _get_redis_client() -> Redis | None:
    """Return a shared Redis client if REDIS_URL is configured, otherwise None."""
    global _redis_client
    if not settings.redis_url:
        return None
    if _redis_client is None:
        with _redis_lock:
            if _redis_client is None:
                _redis_client = Redis.from_url(settings.redis_url, decode_responses=True)
    return _redis_client


def _reset_redis_client() -> None:
    """Reset the cached Redis client (useful for tests)."""
    global _redis_client
    with _redis_lock:
        _redis_client = None

__all__ = [
    "CurrentUser",
    "CurrentTenant",
    "create_access_token",
    "get_current_user",
    "get_current_tenant",
    "get_db",
    "is_feature_enabled",
    "require_paid_plan",
    "require_resource_owner",
    "require_role",
    "require_tenant_quota",
]

# In-memory per-tenant mutation quota tracker.
# In a multi-process deployment this should be replaced with Redis.
_TENANT_QUOTA: dict[tuple[str, str], list[float]] = defaultdict(list)

security = HTTPBearer(auto_error=False)


class CurrentUser(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    tenant_id: uuid.UUID
    role: str = "member"


class CurrentTenant(BaseModel):
    id: uuid.UUID
    name: str
    default_currency: str
    default_hourly_rate: float | None = None


def create_access_token(
    user_id: uuid.UUID,
    email: str,
    name: str,
    tenant_id: uuid.UUID,
    expires_delta: timedelta | None = None,
) -> str:
    to_encode: dict[str, Any] = {
        "sub": str(user_id),
        "email": email,
        "name": name,
        "tenant_id": str(tenant_id),
    }
    expire = datetime.now(UTC) + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    to_encode["exp"] = expire
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)


def _decode_dev_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def _get_or_create_user_from_claims(
    db: Session,
    claims: dict[str, Any],
) -> UserORM:
    """Return an existing user for Clerk claims or provision one on first login."""
    clerk_id = claims.get("sub")
    user = db.query(UserORM).filter(UserORM.clerk_id == clerk_id).first() if clerk_id else None
    if user:
        return user

    email = claims.get("email", "")
    name = claims.get("name") or claims.get("username") or email.split("@")[0] or "Unknown"
    # Use cryptographically random UUIDs rather than deriving IDs from the
    # external clerk_id. Derivable IDs allow account pre-creation / collision
    # attacks by anyone who knows or can guess another user's Clerk `sub`.
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()

    tenant = db.query(TenantORM).filter(TenantORM.id == tenant_id).first()
    is_new_tenant = tenant is None
    if is_new_tenant:
        tenant = TenantORM(id=tenant_id, name=f"{name}'s Workspace")
        db.add(tenant)
        db.flush()

    user = UserORM(
        id=user_id,
        tenant_id=tenant_id,
        email=email,
        name=name,
        clerk_id=clerk_id,
        role="owner" if is_new_tenant else "member",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _get_user_from_dev_token(db: Session, token: str) -> UserORM:
    payload = _decode_dev_token(token)
    user_id = uuid.UUID(payload.get("sub"))
    user = db.query(UserORM).filter(UserORM.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> CurrentUser:
    token = credentials.credentials if credentials else None

    # Fallback to httpOnly session cookie if no Authorization header is present.
    if not token:
        token = request.cookies.get("elite_session")

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if settings.env == "production" and not settings.clerk_jwks_url:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Clerk authentication is required in production",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Prefer Clerk when configured. This allows testing Clerk locally and forces
    # Clerk in production without branching on ENV.
    if settings.clerk_jwks_url:
        try:
            claims = validate_clerk_token(token)
        except ClerkAuthError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=str(exc),
                headers={"WWW-Authenticate": "Bearer"},
            ) from exc
        user = _get_or_create_user_from_claims(db, claims)
    elif settings.env == "development":
        user = _get_user_from_dev_token(db, token)
    else:
        # Dev tokens are intentionally disabled outside development.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication provider not configured",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return CurrentUser(
        id=user.id,
        email=user.email,
        name=user.name,
        tenant_id=user.tenant_id,
        role=user.role or "member",
    )


def require_role(*allowed_roles: str) -> Callable[..., CurrentUser]:
    """Return a dependency that restricts an endpoint to specific user roles."""

    def _check_role(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in allowed_roles:
            log_security_event(
                event_type="authorization",
                actor_id=user.id,
                action="role_check_failed",
                resource_type="endpoint",
                outcome="blocked",
                details={
                    "required_roles": list(allowed_roles),
                    "actual_role": user.role,
                    "tenant_id": user.tenant_id,
                },
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return user

    return _check_role


def get_current_tenant(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CurrentTenant:
    tenant = db.query(TenantORM).filter(TenantORM.id == user.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Tenant not found")
    return CurrentTenant(
        id=tenant.id,
        name=tenant.name,
        default_currency=tenant.default_currency,
        default_hourly_rate=float(tenant.default_hourly_rate)
        if tenant.default_hourly_rate
        else None,
    )


def require_tenant_quota(
    limit: int | None = None,
    window: int | None = None,
    key: str = "default",
) -> Callable[..., None]:
    """Return a dependency that enforces a per-tenant mutation quota.

    Defaults are read from `settings.tenant_quota_limit` and
    `settings.tenant_quota_window`. When REDIS_URL is configured the quota is
    tracked in Redis so it works across serverless/multi-process deployments;
    otherwise it falls back to in-memory tracking.
    """

    def _check(user: CurrentUser = Depends(get_current_user)) -> None:
        """Enforce the per-tenant quota for the current request."""
        quota_limit = limit if limit is not None else settings.tenant_quota_limit
        quota_window = window if window is not None else settings.tenant_quota_window
        now = time.time()
        quota_key = (str(user.tenant_id), key)

        redis_client = _get_redis_client()
        if redis_client is not None:
            redis_key = f"elite:quota:{quota_key[0]}:{quota_key[1]}"
            # Remove entries outside the rolling window, add the current request,
            # and count what remains.
            redis_client.zremrangebyscore(redis_key, 0, now - quota_window)
            redis_client.zadd(redis_key, {str(now): now})
            redis_client.expire(redis_key, quota_window)
            current = redis_client.zcard(redis_key)
            if current > quota_limit:
                # Roll back the timestamp we just added so the count is accurate.
                redis_client.zrem(redis_key, str(now))
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Tenant quota exceeded. Please retry later.",
                )
            return

        # In-memory fallback for local development and single-process deployments.
        window_start = now - quota_window
        _TENANT_QUOTA[quota_key] = [
            ts for ts in _TENANT_QUOTA[quota_key] if ts > window_start
        ]
        if len(_TENANT_QUOTA[quota_key]) >= quota_limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Tenant quota exceeded. Please retry later.",
            )
        _TENANT_QUOTA[quota_key].append(now)

    return _check


def require_paid_plan(
    active_statuses: frozenset[str] = frozenset({"active", "trialing"}),
) -> Callable[..., CurrentUser]:
    """Return a dependency that restricts an endpoint to tenants with paid/trial subscriptions.

    Defaults to treating Paddle 'active' and 'trialing' subscriptions as paid.
    Tenants in platform trial (billing_status='trial' with no subscription) are blocked.
    """

    def _check(
        user: CurrentUser = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> CurrentUser:
        tenant = db.query(TenantORM).filter(TenantORM.id == user.tenant_id).first()
        if tenant is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tenant not found",
            )
        # Use the ORM directly for Foodcart-specific fields.
        foodcart_tenant = (
            db.query(FoodcartTenantORM)
            .filter(FoodcartTenantORM.id == user.tenant_id)
            .first()
        )
        subscription_status = (
            foodcart_tenant.subscription_status if foodcart_tenant else None
        )
        if subscription_status not in active_statuses:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Active subscription required",
            )
        return user

    return _check


def require_resource_owner[T](
    repo_type: type,
    getter: Callable[[Any, uuid.UUID], T | None],
) -> Callable[..., CurrentUser]:
    """Return a dependency that allows mutation only by the resource creator or a tenant owner."""

    def _check(
        resource_id: uuid.UUID,
        user: CurrentUser = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> CurrentUser:
        if user.role == "owner":
            return user
        repo = repo_type(db, user.tenant_id)
        resource = getter(repo, resource_id)
        if resource is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Resource not found",
            )
        if getattr(resource, "created_by", None) != user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return user

    return _check


# is_feature_enabled is re-exported from app.features for backward compatibility.
# It supports Unleash when configured and falls back to ENABLED_FEATURES env var.
