"""FastAPI dependencies for auth, database, tenant isolation, and quotas."""

from __future__ import annotations

import time
import uuid
from collections import defaultdict
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.clerk import ClerkAuthError, validate_clerk_token
from app.config import settings
from app.features import is_feature_enabled
from infrastructure.database import get_db
from infrastructure.models import Tenant as TenantORM
from infrastructure.models import User as UserORM

__all__ = [
    "CurrentUser",
    "CurrentTenant",
    "create_access_token",
    "get_current_user",
    "get_current_tenant",
    "get_db",
    "is_feature_enabled",
    "require_role",
    "require_tenant_quota",
]

# In-memory per-tenant mutation quota tracker.
# In a multi-process deployment this should be replaced with Redis.
_TENANT_QUOTA: dict[tuple[str, str], list[float]] = defaultdict(list)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
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
    tenant_id = uuid.uuid5(uuid.NAMESPACE_URL, f"clerk://user/{clerk_id}")
    user_id = uuid.uuid5(uuid.NAMESPACE_URL, f"clerk://user/{clerk_id}")

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
    `settings.tenant_quota_window`. The quota is tracked in process memory, so
    it is most accurate behind a single worker or with sticky sessions. Replace
    with Redis for multi-process deployments.
    """

    def _check(user: CurrentUser = Depends(get_current_user)) -> None:
        """Enforce the per-tenant quota for the current request."""
        now = time.time()
        quota_key = (str(user.tenant_id), key)
        quota_limit = limit if limit is not None else settings.tenant_quota_limit
        quota_window = window if window is not None else settings.tenant_quota_window
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


# is_feature_enabled is re-exported from app.features for backward compatibility.
# It supports Unleash when configured and falls back to ENABLED_FEATURES env var.
