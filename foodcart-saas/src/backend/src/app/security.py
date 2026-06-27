"""CSRF protection and security helpers for cookie-based authentication.

When the frontend authenticates via the httpOnly ``elite_session`` cookie, state-
changing requests must include a matching ``X-CSRF-Token`` header. Requests that
use an ``Authorization: Bearer`` header are exempt because the token is not
automatically sent by the browser.
"""

from __future__ import annotations

import secrets
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse

from app.config import settings

_CSRF_COOKIE_NAME = "csrf_token"
_CSRF_HEADER_NAME = "x-csrf-token"
_COOKIE_AUTH_NAME = "elite_session"


def generate_csrf_token() -> str:
    """Return a cryptographically random CSRF token."""
    return secrets.token_urlsafe(32)


def set_csrf_cookie(response: Response, token: str) -> None:
    """Set the CSRF token cookie.

    The cookie is intentionally *not* httpOnly so JavaScript can read it and
    send the value back as a request header.
    """
    response.set_cookie(
        key=_CSRF_COOKIE_NAME,
        value=token,
        httponly=False,
        secure=settings.env != "development",
        samesite="strict",
        max_age=60 * settings.access_token_expire_minutes,
        path="/",
    )


def delete_csrf_cookie(response: Response) -> None:
    """Clear the CSRF token cookie."""
    response.delete_cookie(key=_CSRF_COOKIE_NAME, path="/")


def _is_state_changing(method: str) -> bool:
    return method.upper() in {"POST", "PUT", "PATCH", "DELETE"}


def _has_cookie_auth(request: Request) -> bool:
    return _COOKIE_AUTH_NAME in request.cookies


def _has_bearer_auth(request: Request) -> bool:
    auth = request.headers.get("Authorization", "")
    return auth.lower().startswith("bearer ")


# Paths that are intentionally exempt from CSRF because they either bootstrap
# authentication (login) or verify their own signatures (webhooks).
_CSRF_EXEMPT_PATHS = {"/api/v1/auth/token", "/api/v1/webhooks/paddle"}


def validate_csrf_token(request: Request) -> bool:
    """Return True if the request passes CSRF validation.

    Non-state-changing requests and bearer-authenticated requests always pass.
    Cookie-authenticated state-changing requests require the X-CSRF-Token header
    to match the csrf_token cookie.
    """
    if not _is_state_changing(request.method):
        return True

    if request.url.path in _CSRF_EXEMPT_PATHS:
        return True

    if _has_bearer_auth(request):
        return True

    if not _has_cookie_auth(request):
        # No cookie auth means no CSRF risk from this mechanism.
        return True

    cookie_token = request.cookies.get(_CSRF_COOKIE_NAME)
    header_token = request.headers.get(_CSRF_HEADER_NAME)

    if not cookie_token or not header_token:
        return False

    return secrets.compare_digest(cookie_token, header_token)


async def csrf_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Reject cookie-authenticated state-changing requests without a CSRF token."""
    if not validate_csrf_token(request):
        return JSONResponse(
            status_code=403,
            content={"detail": "CSRF token missing or invalid"},
        )
    return await call_next(request)
