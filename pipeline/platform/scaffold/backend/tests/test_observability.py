from unittest.mock import patch

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
