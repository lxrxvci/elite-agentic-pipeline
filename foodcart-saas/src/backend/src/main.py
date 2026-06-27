"""FastAPI application composition."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.config import settings
from app.exceptions import add_exception_handlers
from app.features import shutdown_feature_client
from app.limiter import limiter
from app.observability import (
    configure_logging,
    configure_tracing,
    metrics_response,
    observability_middleware,
    shutdown_tracing,
)
from app.routers import (
    auth,
    billing,
    clients,
    domains,
    invoices,
    me,
    projects,
    telemetry,
    time_entries,
    vitals,
    webhooks,
)
from app.routers.foodcart import (
    ai,
    content,
    ingest,
    onboarding,
    public,
    revisions,
    sites,
    uploads,
)
from app.security import csrf_middleware
from infrastructure.database import ping_database

# Configure logging and tracing at import time so local development, Docker,
# and serverless runtimes all have them available immediately.
configure_logging(env=settings.env, log_level=settings.log_level)
configure_tracing()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialize and cleanly shut down stateful resources.

    Re-initializing logging/tracing here is idempotent. The main purpose is to
    shut down background threads (Unleash poller, OpenTelemetry batch exporter)
    before a serverless invocation ends.
    """
    configure_logging(env=settings.env, log_level=settings.log_level)
    configure_tracing()

    if settings.otel_exporter_otlp_endpoint:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

        FastAPIInstrumentor.instrument_app(app)

    yield

    shutdown_feature_client()
    shutdown_tracing()


app = FastAPI(title="Elite API", version="0.1.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)


async def rate_limit_exceeded_handler(request: Request, exc: Exception) -> JSONResponse:
    """Return a 429 response when a client exceeds the rate limit."""
    _ = request, exc
    return JSONResponse(
        status_code=429,
        content={"detail": "Rate limit exceeded"},
    )


app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

_raw_origins = os.getenv("ALLOWED_ORIGINS", "")
_ALLOWED_ORIGINS = [origin.strip() for origin in _raw_origins.split(",") if origin.strip()]
if settings.env == "development" and not _ALLOWED_ORIGINS:
    _ALLOWED_ORIGINS = ["http://localhost:3000"]
if settings.env != "development" and not _ALLOWED_ORIGINS:
    raise RuntimeError("ALLOWED_ORIGINS must be set in non-development environments")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "Idempotency-Key",
        "X-Correlation-Id",
        "X-CSRF-Token",
    ],
)


# Observability middleware is defined in app.observability so it can be reused
# and tested in isolation. It adds correlation IDs, structured request logging,
# and latency histograms.
app.middleware("http")(observability_middleware)

# CSRF protection for cookie-backed mutations. Bearer-authenticated requests and
# safe HTTP methods are exempt.
app.middleware("http")(csrf_middleware)


@app.middleware("http")
async def security_headers(request: Request, call_next: Callable[[Request], Any]) -> Response:
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    storage_origin = ""
    if settings.storage_public_url:
        from urllib.parse import urlparse

        parsed = urlparse(settings.storage_public_url)
        storage_origin = f" {parsed.scheme}://{parsed.netloc}"
    elif settings.storage_endpoint:
        from urllib.parse import urlparse

        parsed = urlparse(settings.storage_endpoint)
        storage_origin = f" {parsed.scheme}://{parsed.netloc}"

    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        f"img-src 'self' data:{storage_origin}; "
        "font-src 'self'; "
        "connect-src 'self'; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self';"
    )
    if settings.env != "development":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


add_exception_handlers(app)

# Webhooks must receive raw request bodies for signature verification.
app.include_router(webhooks.router, prefix="/api/v1")

app.include_router(me.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1")
app.include_router(clients.router, prefix="/api/v1")
app.include_router(projects.router, prefix="/api/v1")
app.include_router(time_entries.router, prefix="/api/v1")
app.include_router(invoices.router, prefix="/api/v1")
app.include_router(vitals.router, prefix="/api/v1")
app.include_router(telemetry.router, prefix="/api/v1")

app.include_router(onboarding.router, prefix="/api/v1")
app.include_router(sites.router, prefix="/api/v1")
app.include_router(content.router, prefix="/api/v1")
app.include_router(ingest.router, prefix="/api/v1")
app.include_router(ai.router, prefix="/api/v1")
app.include_router(revisions.router, prefix="/api/v1")
app.include_router(uploads.router, prefix="/api/v1")
app.include_router(public.router, prefix="/api/v1")
app.include_router(billing.router, prefix="/api/v1")
app.include_router(domains.router, prefix="/api/v1")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
def ready() -> dict[str, str]:
    if ping_database():
        return {"status": "ready"}
    return {"status": "not_ready"}


@app.get("/metrics")
def metrics() -> Response:
    data, content_type = metrics_response()
    if not data:
        return Response(status_code=404)
    return Response(content=data, media_type=content_type)
