"""FastAPI application composition."""

from __future__ import annotations

import os
import time
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Any

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from slowapi.errors import RateLimitExceeded

from app.config import settings
from app.exceptions import add_exception_handlers
from app.features import shutdown_feature_client
from app.limiter import limiter
from app.observability import (
    configure_logging,
    configure_tracing,
    get_logger,
    get_metrics_provider,
    metrics_response,
    shutdown_tracing,
)
from app.routers import auth, clients, invoices, me, projects, time_entries
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


async def rate_limit_exceeded_handler(request: Request, exc: Exception) -> JSONResponse:
    """Return a 429 response when a client exceeds the rate limit."""
    _ = request, exc
    return JSONResponse(
        status_code=429,
        content={"detail": "Rate limit exceeded"},
    )


app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def observability_middleware(
    request: Request,
    call_next: Callable[[Request], Any],
) -> Response:
    """Add correlation IDs, structured request logging, and latency metrics."""
    correlation_id = request.headers.get("x-correlation-id") or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(correlation_id=correlation_id)

    logger = get_logger("app.request")
    logger.info(
        "request_started",
        method=request.method,
        path=request.url.path,
        query=str(request.query_params),
    )

    start = time.perf_counter()
    response: Response = await call_next(request)
    duration = time.perf_counter() - start

    logger.info(
        "request_finished",
        method=request.method,
        path=request.url.path,
        status_code=response.status_code,
    )
    get_metrics_provider().observe_request_latency(
        method=request.method,
        path=request.url.path,
        status_code=response.status_code,
        duration=duration,
    )
    response.headers["x-correlation-id"] = correlation_id
    return response


@app.middleware("http")
async def security_headers(request: Request, call_next: Callable[[Request], Any]) -> Response:
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
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

app.include_router(me.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1")
app.include_router(clients.router, prefix="/api/v1")
app.include_router(projects.router, prefix="/api/v1")
app.include_router(time_entries.router, prefix="/api/v1")
app.include_router(invoices.router, prefix="/api/v1")


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
