"""Unified observability configuration for local and production environments.

Local development uses a self-hosted Prometheus exporter on /metrics.
Production (Vercel, containers with OTLP collector) sends metrics, traces, and
logs via OpenTelemetry OTLP.

Wiring
------
- ``configure_logging`` and ``configure_tracing`` are called at import time in
  ``src/main.py`` so that structured logs and distributed traces are available
  immediately in local development, Docker, and serverless runtimes.
- ``observability_middleware`` is registered in ``src/main.py`` as an HTTP
  middleware. It attaches a correlation ID, emits structured request logs, and
  records request latency histograms via the configured metrics provider.
- ``metrics_response`` powers the ``/metrics`` endpoint in ``src/main.py``.
- Business counters (logins, invoices, time entries) are incremented from
  individual routers using ``get_metrics_provider().increment()``.
- The metrics provider is selected lazily by ``get_metrics_provider()``:
  OTLP when ``OTEL_EXPORTER_OTLP_ENDPOINT`` is set, Prometheus by default in
  non-test environments, and a no-op provider when ``METRICS_ENABLED=false``.
"""

from __future__ import annotations

import logging
import os
import sys
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import structlog
from fastapi import Request
from fastapi.responses import Response
from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest

from app.config import settings


class NoopMetricsProvider:
    """Fallback when neither Prometheus nor OTLP metrics are enabled."""

    def observe_request_latency(
        self,
        method: str,
        path: str,
        status_code: int,
        duration: float,
    ) -> None:
        return None

    def increment(self, name: str, tenant_id: str) -> None:
        return None

    def observe_upload(self, status: str, tenant_id: str) -> None:
        return None

    def observe_onboarding_completion(
        self,
        photo_enabled: str,
        photo_used: str,
        tenant_id: str,
    ) -> None:
        return None

    def observe_photo_enrichment(self, status: str) -> None:
        return None

    def observe_photo_vision_duration(self, seconds: float) -> None:
        return None

    def observe_photo_places_duration(self, seconds: float) -> None:
        return None

    def observe_ai_duration(self, seconds: float) -> None:
        return None

    def observe_telemetry(self, event: str) -> None:
        return None


class PrometheusMetricsProvider:
    """In-process Prometheus counters/histograms for local development."""

    LOGIN_COUNTER = Counter(
        "elite_logins_total",
        "Total number of successful logins",
        ["tenant_id"],
    )

    TIME_ENTRY_COUNTER = Counter(
        "elite_time_entries_created_total",
        "Total number of time entries created",
        ["tenant_id"],
    )

    INVOICE_COUNTER = Counter(
        "elite_invoices_created_total",
        "Total number of invoices created",
        ["tenant_id"],
    )

    UPLOADS_COUNTER = Counter(
        "elite_uploads_total",
        "Total number of upload requests",
        ["status", "tenant_id"],
    )

    ONBOARDING_COMPLETIONS_COUNTER = Counter(
        "elite_onboarding_completions_total",
        "Total number of completed tenant onboardings",
        ["photo_enabled", "photo_used", "tenant_id"],
    )

    PHOTO_ENRICHMENT_COUNTER = Counter(
        "elite_photo_enrichment_total",
        "Total number of photo enrichment runs",
        ["status"],
    )

    REQUEST_LATENCY = Histogram(
        "elite_request_duration_seconds",
        "HTTP request latency in seconds",
        ["method", "path", "status_code"],
        buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
    )

    PHOTO_VISION_DURATION = Histogram(
        "elite_photo_vision_duration_seconds",
        "Photo vision analysis latency in seconds",
        buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
    )

    PHOTO_PLACES_DURATION = Histogram(
        "elite_photo_places_duration_seconds",
        "Google Places enrichment latency in seconds",
        buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
    )

    AI_REQUEST_DURATION = Histogram(
        "elite_ai_request_duration_seconds",
        "AI request latency in seconds",
        buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
    )

    TELEMETRY_COUNTER = Counter(
        "elite_telemetry_events_total",
        "Total number of frontend telemetry events received",
        ["event"],
    )

    def observe_request_latency(
        self,
        method: str,
        path: str,
        status_code: int,
        duration: float,
    ) -> None:
        self.REQUEST_LATENCY.labels(
            method=method,
            path=path,
            status_code=str(status_code),
        ).observe(duration)

    def increment(self, name: str, tenant_id: str) -> None:
        counter = getattr(self, f"{name.upper()}_COUNTER", None)
        if counter is not None:
            counter.labels(tenant_id=str(tenant_id)).inc()

    def observe_upload(self, status: str, tenant_id: str) -> None:
        self.UPLOADS_COUNTER.labels(
            status=status,
            tenant_id=str(tenant_id),
        ).inc()

    def observe_onboarding_completion(
        self,
        photo_enabled: str,
        photo_used: str,
        tenant_id: str,
    ) -> None:
        self.ONBOARDING_COMPLETIONS_COUNTER.labels(
            photo_enabled=photo_enabled,
            photo_used=photo_used,
            tenant_id=str(tenant_id),
        ).inc()

    def observe_photo_enrichment(self, status: str) -> None:
        self.PHOTO_ENRICHMENT_COUNTER.labels(status=status).inc()

    def observe_photo_vision_duration(self, seconds: float) -> None:
        self.PHOTO_VISION_DURATION.observe(seconds)

    def observe_photo_places_duration(self, seconds: float) -> None:
        self.PHOTO_PLACES_DURATION.observe(seconds)

    def observe_ai_duration(self, seconds: float) -> None:
        self.AI_REQUEST_DURATION.observe(seconds)

    def observe_telemetry(self, event: str) -> None:
        self.TELEMETRY_COUNTER.labels(event=event).inc()


def _parse_headers(header_string: str) -> dict[str, str]:
    headers: dict[str, str] = {}
    for pair in header_string.split(","):
        pair = pair.strip()
        if "=" in pair:
            key, value = pair.split("=", 1)
            headers[key.strip()] = value.strip()
    return headers


def _build_resource() -> Resource:
    attributes: dict[str, Any] = {"service.name": settings.otel_service_name}
    for pair in settings.otel_resource_attributes.split(","):
        if "=" in pair:
            key, value = pair.split("=", 1)
            attributes[key.strip()] = value.strip()
    return Resource(attributes=attributes)


class OtelMetricsProvider:
    """OpenTelemetry metric counters/histograms for OTLP backends."""

    def __init__(self) -> None:
        resource = _build_resource()
        metric_headers = _parse_headers(settings.otel_exporter_otlp_headers)
        exporter = OTLPMetricExporter(
            endpoint=settings.otel_exporter_otlp_endpoint,
            headers=metric_headers,
        )
        reader = PeriodicExportingMetricReader(exporter, export_interval_millis=60000)
        provider = MeterProvider(resource=resource, metric_readers=[reader])
        metrics.set_meter_provider(provider)

        meter = metrics.get_meter(__name__)
        self._login_counter = meter.create_counter(
            "elite_logins_total",
            description="Total number of successful logins",
        )
        self._time_entry_counter = meter.create_counter(
            "elite_time_entries_created_total",
            description="Total number of time entries created",
        )
        self._invoice_counter = meter.create_counter(
            "elite_invoices_created_total",
            description="Total number of invoices created",
        )
        self._uploads_counter = meter.create_counter(
            "elite_uploads_total",
            description="Total number of upload requests",
        )
        self._onboarding_completions_counter = meter.create_counter(
            "elite_onboarding_completions_total",
            description="Total number of completed tenant onboardings",
        )
        self._photo_enrichment_counter = meter.create_counter(
            "elite_photo_enrichment_total",
            description="Total number of photo enrichment runs",
        )
        self._request_latency = meter.create_histogram(
            "elite_request_duration_seconds",
            description="HTTP request latency in seconds",
        )
        self._photo_vision_duration = meter.create_histogram(
            "elite_photo_vision_duration_seconds",
            description="Photo vision analysis latency in seconds",
        )
        self._photo_places_duration = meter.create_histogram(
            "elite_photo_places_duration_seconds",
            description="Google Places enrichment latency in seconds",
        )
        self._ai_request_duration = meter.create_histogram(
            "elite_ai_request_duration_seconds",
            description="AI request latency in seconds",
        )
        self._telemetry_counter = meter.create_counter(
            "elite_telemetry_events_total",
            description="Total number of frontend telemetry events received",
        )

    def observe_request_latency(
        self,
        method: str,
        path: str,
        status_code: int,
        duration: float,
    ) -> None:
        self._request_latency.record(
            duration,
            {"method": method, "path": path, "status_code": str(status_code)},
        )

    def increment(self, name: str, tenant_id: str) -> None:
        counter = getattr(self, f"_{name}_counter", None)
        if counter is not None:
            counter.add(1, {"tenant_id": str(tenant_id)})

    def observe_upload(self, status: str, tenant_id: str) -> None:
        self._uploads_counter.add(
            1,
            {"status": status, "tenant_id": str(tenant_id)},
        )

    def observe_onboarding_completion(
        self,
        photo_enabled: str,
        photo_used: str,
        tenant_id: str,
    ) -> None:
        self._onboarding_completions_counter.add(
            1,
            {
                "photo_enabled": photo_enabled,
                "photo_used": photo_used,
                "tenant_id": str(tenant_id),
            },
        )

    def observe_photo_enrichment(self, status: str) -> None:
        self._photo_enrichment_counter.add(1, {"status": status})

    def observe_photo_vision_duration(self, seconds: float) -> None:
        self._photo_vision_duration.record(seconds)

    def observe_photo_places_duration(self, seconds: float) -> None:
        self._photo_places_duration.record(seconds)

    def observe_ai_duration(self, seconds: float) -> None:
        self._ai_request_duration.record(seconds)

    def observe_telemetry(self, event: str) -> None:
        self._telemetry_counter.add(1, {"event": event})


_metrics_provider: PrometheusMetricsProvider | OtelMetricsProvider | NoopMetricsProvider | None = (
    None
)


def get_metrics_provider() -> PrometheusMetricsProvider | OtelMetricsProvider | NoopMetricsProvider:
    global _metrics_provider  # noqa: PLW0603
    if _metrics_provider is None:
        if settings.otel_exporter_otlp_endpoint:
            _metrics_provider = OtelMetricsProvider()
        elif os.getenv("METRICS_ENABLED", "true").lower() not in {"0", "false", "no"}:
            _metrics_provider = PrometheusMetricsProvider()
        else:
            _metrics_provider = NoopMetricsProvider()
    return _metrics_provider


def configure_tracing() -> None:
    """Configure OpenTelemetry tracing when OTEL_EXPORTER_OTLP_ENDPOINT is set."""
    endpoint = settings.otel_exporter_otlp_endpoint
    if not endpoint:
        return

    resource = _build_resource()
    provider = TracerProvider(resource=resource)
    trace_headers = _parse_headers(settings.otel_exporter_otlp_headers)
    exporter = OTLPSpanExporter(endpoint=endpoint, headers=trace_headers)
    processor = BatchSpanProcessor(exporter)
    provider.add_span_processor(processor)
    trace.set_tracer_provider(provider)


def shutdown_tracing() -> None:
    """Flush and shutdown the global tracer provider, if configured."""
    provider = trace.get_tracer_provider()
    if provider is None:
        return
    try:
        provider.force_flush(timeout_millis=5000)  # type: ignore[attr-defined]
        provider.shutdown()  # type: ignore[attr-defined]
    except Exception:
        get_logger(__name__).debug("tracing_shutdown_failed", exc_info=True)


def configure_logging(env: str = "development", log_level: str = "info") -> None:
    """Configure structlog and stdlib logging for JSON output in production."""
    shared_processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.stdlib.ExtraAdder(),
    ]

    if env == "development":
        processors = shared_processors + [
            structlog.dev.ConsoleRenderer(colors=True),
        ]
    else:
        processors = shared_processors + [
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer(),
        ]

    structlog.configure(
        processors=processors,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    level = getattr(logging, log_level.upper(), logging.INFO)
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=level,
    )


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """Return a structured logger."""
    return structlog.get_logger(name)  # type: ignore[no-any-return]


async def correlation_id_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Attach a correlation ID to every request for distributed tracing.

    The correlation ID is read from the ``x-correlation-id`` header when
    present, otherwise a new UUID is generated. It is bound to the structlog
    context and echoed back in the response headers.
    """
    correlation_id = request.headers.get("x-correlation-id") or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(correlation_id=correlation_id)
    response = await call_next(request)
    response.headers["x-correlation-id"] = correlation_id
    return response


async def request_logging_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Log structured request/response details.

    Emits ``request_started`` and ``request_finished`` events. These logs are
    the primary source for request volume, path distribution, and status-code
    analysis in Loki / OpenTelemetry log backends.
    """
    logger = get_logger("app.request")
    logger.info(
        "request_started",
        method=request.method,
        path=request.url.path,
        query=str(request.query_params),
    )
    response = await call_next(request)
    logger.info(
        "request_finished",
        method=request.method,
        path=request.url.path,
        status_code=response.status_code,
    )
    return response


async def observability_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Combined observability middleware.

    This is the canonical middleware registered in ``src/main.py``. It:

    1. Generates or propagates a correlation ID.
    2. Logs request start/finish events.
    3. Records request latency histograms for the configured provider.

    Keeping the combined implementation here ensures the metrics, logs, and
    traces share the same request lifecycle and path normalization.
    """
    import time

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
    response = await call_next(request)
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


def metrics_response() -> tuple[bytes, str]:
    """Return Prometheus metrics payload when Prometheus is enabled."""
    if isinstance(get_metrics_provider(), PrometheusMetricsProvider):
        return generate_latest(), CONTENT_TYPE_LATEST
    return b"", CONTENT_TYPE_LATEST
