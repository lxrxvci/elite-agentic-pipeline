"""Authentication helper router for local development and tests.

In production this MUST be replaced by an OIDC provider integration. The dev
auto-provisioning endpoint below is disabled unless ENV=development.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.audit import log_security_event
from app.config import settings
from app.dependencies import create_access_token, get_db
from app.limiter import limiter
from app.observability import get_metrics_provider
from app.security import delete_csrf_cookie, generate_csrf_token, set_csrf_cookie
from infrastructure.models import Tenant, User

router = APIRouter(prefix="/auth", tags=["Auth"])


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class DevLoginRequest(BaseModel):
    email: str


def _set_auth_cookie(response: Response, token: str) -> None:
    """Set the session token as an httpOnly cookie."""
    response.set_cookie(
        key="elite_session",
        value=token,
        httponly=True,
        secure=settings.env != "development",
        samesite="strict",
        max_age=60 * settings.access_token_expire_minutes,
        path="/",
    )


@router.post("/token", response_model=TokenResponse)
@limiter.limit("5/minute")
def dev_token(
    request: Request,
    response: Response,
    payload: DevLoginRequest,
    db: Session = Depends(get_db),
) -> TokenResponse:
    """Return a token for development/testing only.

    In production this endpoint must be removed and replaced with an OIDC flow.
    The token is also set as an httpOnly cookie for secure frontend usage.
    """
    if settings.env != "development":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Not found",
        )

    user = db.query(User).filter(User.email == payload.email).first()
    if not user:
        # Auto-create a tenant and user for dev convenience only
        tenant = Tenant(name="Dev Tenant")
        db.add(tenant)
        db.flush()
        user = User(
            id=uuid.uuid4(),
            tenant_id=tenant.id,
            email=payload.email,
            name=payload.email.split("@")[0],
            role="owner",
        )
        db.add(user)
        db.commit()

    log_security_event(
        event_type="auth",
        actor_id=user.id,
        action="login",
        resource_type="user",
        resource_id=user.id,
        outcome="success",
        details={"method": "dev_token", "tenant_id": user.tenant_id},
    )

    token = create_access_token(
        user_id=user.id,
        email=user.email,
        name=user.name,
        tenant_id=user.tenant_id,
    )
    _set_auth_cookie(response, token)
    set_csrf_cookie(response, generate_csrf_token())
    get_metrics_provider().increment("login", str(user.tenant_id))
    return TokenResponse(access_token=token)


@router.post("/logout")
def logout(response: Response) -> dict[str, str]:
    """Clear the session and CSRF cookies."""
    response.delete_cookie(key="elite_session", path="/")
    delete_csrf_cookie(response)
    log_security_event(
        event_type="auth",
        actor_id=None,
        action="logout",
        resource_type="session",
        outcome="success",
    )
    return {"status": "logged_out"}
