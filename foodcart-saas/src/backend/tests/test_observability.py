from unittest.mock import patch

import pytest
from fastapi import Request
from fastapi.responses import PlainTextResponse
from fastapi.testclient import TestClient

from app import observability
from app.config import Settings


def test_parse_headers_parses_comma_separated_pairs() -> None:
    assert observability._parse_headers("Authorization=Basic abc, X-Scope-OrgID=1") == {
        "Authorization": "Basic abc",
        "X-Scope-OrgID": "1",
    }


def test_parse_headers_ignores_empty_and_malformed() -> None:
    assert observability._parse_headers("Authorization=Basic abc, badpair, ") == {
        "Authorization": "Basic abc",
    }


def test_build_resource_uses_service_name_and_attributes(monkeypatch) -> None:
    settings = Settings(
        secret_key="test",
        otel_service_name="elite-backend-test",
        otel_resource_attributes="deployment.environment=test,service.version=1.0.0",
    )
    monkeypatch.setattr(observability.settings, "otel_service_name", settings.otel_service_name)
    monkeypatch.setattr(
        observability.settings, "otel_resource_attributes", settings.otel_resource_attributes
    )

    resource = observability._build_resource()
    assert resource.attributes["service.name"] == "elite-backend-test"
    assert resource.attributes["deployment.environment"] == "test"
    assert resource.attributes["service.version"] == "1.0.0"


def test_otel_metrics_provider_uses_headers(monkeypatch) -> None:
    settings = Settings(
        secret_key="test",
        otel_exporter_otlp_endpoint="https://otlp.example.com",
        otel_exporter_otlp_headers="Authorization=Basic token",
    )
    monkeypatch.setattr(
        observability.settings, "otel_exporter_otlp_endpoint", settings.otel_exporter_otlp_endpoint
    )
    monkeypatch.setattr(
        observability.settings, "otel_exporter_otlp_headers", settings.otel_exporter_otlp_headers
    )

    with patch("app.observability.metrics.set_meter_provider") as mock_set:
        provider = observability.OtelMetricsProvider()
        assert provider is not None
        mock_set.assert_called_once()


def test_configure_tracing_with_endpoint(monkeypatch) -> None:
    settings = Settings(
        secret_key="test",
        otel_exporter_otlp_endpoint="https://otlp.example.com",
        otel_exporter_otlp_headers="Authorization=Basic token",
    )
    monkeypatch.setattr(
        observability.settings, "otel_exporter_otlp_endpoint", settings.otel_exporter_otlp_endpoint
    )
    monkeypatch.setattr(
        observability.settings, "otel_exporter_otlp_headers", settings.otel_exporter_otlp_headers
    )

    with patch("app.observability.trace.set_tracer_provider") as mock_set:
        observability.configure_tracing()
        mock_set.assert_called_once()


def test_configure_tracing_without_endpoint(monkeypatch) -> None:
    monkeypatch.setattr(observability.settings, "otel_exporter_otlp_endpoint", "")

    with patch("app.observability.trace.set_tracer_provider") as mock_set:
        observability.configure_tracing()
        mock_set.assert_not_called()


def test_get_metrics_provider_selects_otlp_when_endpoint_set(monkeypatch) -> None:
    monkeypatch.setattr(
        observability.settings, "otel_exporter_otlp_endpoint", "https://otlp.example.com"
    )
    monkeypatch.setattr(observability.settings, "otel_exporter_otlp_headers", "")
    observability._metrics_provider = None

    with patch("app.observability.metrics.set_meter_provider"):
        provider = observability.get_metrics_provider()
        assert isinstance(provider, observability.OtelMetricsProvider)


def test_get_metrics_provider_selects_prometheus_by_default(monkeypatch) -> None:
    monkeypatch.setattr(observability.settings, "otel_exporter_otlp_endpoint", "")
    observability._metrics_provider = None

    provider = observability.get_metrics_provider()
    assert isinstance(provider, observability.PrometheusMetricsProvider)


def test_get_metrics_provider_can_be_disabled(monkeypatch) -> None:
    monkeypatch.setattr(observability.settings, "otel_exporter_otlp_endpoint", "")
    monkeypatch.setenv("METRICS_ENABLED", "false")
    observability._metrics_provider = None

    provider = observability.get_metrics_provider()
    assert isinstance(provider, observability.NoopMetricsProvider)


@pytest.mark.asyncio
async def test_correlation_id_middleware_propagates_and_echos_id() -> None:
    async def handler(request: Request) -> PlainTextResponse:
        return PlainTextResponse("ok")

    request = Request(
        {"type": "http", "method": "GET", "path": "/", "headers": [], "query_string": b""}
    )
    request.scope["headers"] = [(b"x-correlation-id", b"inbound-id")]
    response = await observability.correlation_id_middleware(request, handler)
    assert response.headers["x-correlation-id"] == "inbound-id"


@pytest.mark.asyncio
async def test_correlation_id_middleware_generates_id_when_missing() -> None:
    async def handler(request: Request) -> PlainTextResponse:
        return PlainTextResponse("ok")

    request = Request(
        {"type": "http", "method": "GET", "path": "/", "headers": [], "query_string": b""}
    )
    response = await observability.correlation_id_middleware(request, handler)
    assert "x-correlation-id" in response.headers
    assert len(response.headers["x-correlation-id"]) == 36


@pytest.mark.asyncio
async def test_request_logging_middleware_logs_start_and_finish(caplog) -> None:
    async def handler(request: Request) -> PlainTextResponse:
        return PlainTextResponse("ok", status_code=201)

    request = Request(
        {"type": "http", "method": "POST", "path": "/test", "headers": [], "query_string": b""}
    )
    with patch("app.observability.get_logger") as mock_get_logger:
        mock_logger = mock_get_logger.return_value
        await observability.request_logging_middleware(request, handler)
        assert mock_logger.info.call_count == 2
        start_call = mock_logger.info.call_args_list[0]
        finish_call = mock_logger.info.call_args_list[1]
        assert start_call.kwargs["method"] == "POST"
        assert start_call.kwargs["path"] == "/test"
        assert finish_call.kwargs["status_code"] == 201


@pytest.mark.asyncio
async def test_observability_middleware_records_latency_metric(monkeypatch) -> None:
    provider = observability.NoopMetricsProvider()
    monkeypatch.setattr(observability, "_metrics_provider", provider)
    observed = {}

    def fake_observe(method: str, path: str, status_code: int, duration: float) -> None:
        observed.update(
            {"method": method, "path": path, "status_code": status_code, "duration": duration}
        )

    monkeypatch.setattr(provider, "observe_request_latency", fake_observe)

    async def handler(request: Request) -> PlainTextResponse:
        return PlainTextResponse("ok", status_code=200)

    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/v1/health",
            "headers": [],
            "query_string": b"",
        }
    )
    response = await observability.observability_middleware(request, handler)
    assert response.headers["x-correlation-id"]
    assert observed["method"] == "GET"
    assert observed["path"] == "/api/v1/health"
    assert observed["status_code"] == 200
    assert observed["duration"] >= 0


def test_observability_middleware_is_wired_in_main_app() -> None:
    """Smoke test that the FastAPI app in main.py uses observability_middleware."""
    from main import app

    with TestClient(app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert "x-correlation-id" in response.headers


class TestPrometheusMetricsProvider:
    def test_increment_keeps_backward_compatibility(self) -> None:
        provider = observability.PrometheusMetricsProvider()
        # Smoke test: increment should not raise and should update the counter.
        provider.increment("login", tenant_id="tenant-1")

    def test_observe_upload_records_status_labels(self) -> None:
        provider = observability.PrometheusMetricsProvider()
        with patch.object(provider.UPLOADS_COUNTER, "labels") as mock_labels:
            provider.observe_upload(status="initiated", tenant_id="tenant-1")
            mock_labels.assert_called_once_with(status="initiated", tenant_id="tenant-1")
            mock_labels.return_value.inc.assert_called_once_with()

    def test_observe_onboarding_completion_records_labels(self) -> None:
        provider = observability.PrometheusMetricsProvider()
        with patch.object(provider.ONBOARDING_COMPLETIONS_COUNTER, "labels") as mock_labels:
            provider.observe_onboarding_completion(
                photo_enabled="true", photo_used="uploaded", tenant_id="tenant-1"
            )
            mock_labels.assert_called_once_with(
                photo_enabled="true",
                photo_used="uploaded",
                tenant_id="tenant-1",
            )
            mock_labels.return_value.inc.assert_called_once_with()

    def test_observe_photo_enrichment_records_status(self) -> None:
        provider = observability.PrometheusMetricsProvider()
        with patch.object(provider.PHOTO_ENRICHMENT_COUNTER, "labels") as mock_labels:
            provider.observe_photo_enrichment("success")
            mock_labels.assert_called_once_with(status="success")
            mock_labels.return_value.inc.assert_called_once_with()

    def test_observe_durations_record_histograms(self) -> None:
        provider = observability.PrometheusMetricsProvider()
        for histogram, value in [
            (provider.PHOTO_VISION_DURATION, 0.123),
            (provider.PHOTO_PLACES_DURATION, 0.234),
            (provider.AI_REQUEST_DURATION, 0.345),
        ]:
            with patch.object(histogram, "observe") as mock_observe:
                if histogram is provider.PHOTO_VISION_DURATION:
                    provider.observe_photo_vision_duration(value)
                elif histogram is provider.PHOTO_PLACES_DURATION:
                    provider.observe_photo_places_duration(value)
                else:
                    provider.observe_ai_duration(value)
                mock_observe.assert_called_once_with(value)


class TestOtelMetricsProvider:
    def test_photo_observability_methods_record_on_otel_counters(self, monkeypatch) -> None:
        monkeypatch.setattr(
            observability.settings, "otel_exporter_otlp_endpoint", "https://otlp.example.com"
        )
        monkeypatch.setattr(observability.settings, "otel_exporter_otlp_headers", "")
        observability._metrics_provider = None

        with patch("app.observability.metrics.set_meter_provider"):
            provider = observability.OtelMetricsProvider()

        patchers = [
            patch.object(provider, "_uploads_counter"),
            patch.object(provider, "_onboarding_completions_counter"),
            patch.object(provider, "_photo_enrichment_counter"),
            patch.object(provider, "_photo_vision_duration"),
            patch.object(provider, "_photo_places_duration"),
            patch.object(provider, "_ai_request_duration"),
        ]
        mocks = [p.start() for p in patchers]

        try:
            provider.observe_upload(status="initiated", tenant_id="tenant-1")
            mocks[0].add.assert_called_once_with(
                1, {"status": "initiated", "tenant_id": "tenant-1"}
            )

            provider.observe_onboarding_completion(
                photo_enabled="true", photo_used="uploaded", tenant_id="tenant-1"
            )
            mocks[1].add.assert_called_once_with(
                1,
                {
                    "photo_enabled": "true",
                    "photo_used": "uploaded",
                    "tenant_id": "tenant-1",
                },
            )

            provider.observe_photo_enrichment("success")
            mocks[2].add.assert_called_once_with(1, {"status": "success"})

            provider.observe_photo_vision_duration(0.123)
            mocks[3].record.assert_called_once_with(0.123)

            provider.observe_photo_places_duration(0.234)
            mocks[4].record.assert_called_once_with(0.234)

            provider.observe_ai_duration(0.345)
            mocks[5].record.assert_called_once_with(0.345)
        finally:
            for p in patchers:
                p.stop()


class TestNoopMetricsProvider:
    def test_photo_observability_methods_are_no_ops(self) -> None:
        provider = observability.NoopMetricsProvider()
        provider.observe_upload(status="initiated", tenant_id="tenant-1")
        provider.observe_onboarding_completion(
            photo_enabled="true", photo_used="uploaded", tenant_id="tenant-1"
        )
        provider.observe_photo_enrichment("success")
        provider.observe_photo_vision_duration(0.1)
        provider.observe_photo_places_duration(0.1)
        provider.observe_ai_duration(0.1)
