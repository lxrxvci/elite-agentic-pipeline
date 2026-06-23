"""Unified observability configuration for local and production environments.

Local development uses a self-hosted Prometheus exporter on /metrics.
Production (Vercel, containers with OTLP collector) sends metrics, traces, and
logs via OpenTelemetry OTLP.
"""

from __future__ import annotations

import logging
import os
import sys
import uuid
from collections.abc import Callable
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

OTEL_SERVICE_NAME = os.getenv("OTEL_SERVICE_NAME", "elite-backend")
OTEL_RESOURCE_ATTRIBUTES = os.getenv("OTEL_RESOURCE_ATTRIBUTES", "")


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

    REQUEST_LATENCY = Histogram(
        "elite_request_duration_seconds",
        "HTTP request latency in seconds",
        ["method", "path", "status_code"],
        buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
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


def _build_resource() -> Resource:
    attributes: dict[str, Any] = {"service.name": OTEL_SERVICE_NAME}
    for pair in OTEL_RESOURCE_ATTRIBUTES.split(","):
        if "=" in pair:
            key, value = pair.split("=", 1)
            attributes[key.strip()] = value.strip()
    return Resource(attributes=attributes)


class OtelMetricsProvider:
    """OpenTelemetry metric counters/histograms for OTLP backends."""

    def __init__(self) -> None:
        resource = _build_resource()
        exporter = OTLPMetricExporter(endpoint=settings.otel_exporter_otlp_endpoint)
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
        self._request_latency = meter.create_histogram(
            "elite_request_duration_seconds",
            description="HTTP request latency in seconds",
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
    exporter = OTLPSpanExporter(endpoint=endpoint)
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
        pass


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


def correlation_id_middleware(request: Request, call_next: Callable[[Request], Any]) -> Response:
    """Attach a correlation ID to every request for distributed tracing."""
    correlation_id = request.headers.get("x-correlation-id") or str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(correlation_id=correlation_id)
    response: Response = call_next(request)
    response.headers["x-correlation-id"] = correlation_id
    return response


def request_logging_middleware(request: Request, call_next: Callable[[Request], Any]) -> Response:
    """Log request/response details."""
    logger = get_logger("app.request")
    logger.info(
        "request_started",
        method=request.method,
        path=request.url.path,
        query=str(request.query_params),
    )
    response: Response = call_next(request)
    logger.info(
        "request_finished",
        method=request.method,
        path=request.url.path,
        status_code=response.status_code,
    )
    return response


def metrics_response() -> tuple[bytes, str]:
    """Return Prometheus metrics payload when Prometheus is enabled."""
    if isinstance(get_metrics_provider(), PrometheusMetricsProvider):
        return generate_latest(), CONTENT_TYPE_LATEST
    return b"", CONTENT_TYPE_LATEST
