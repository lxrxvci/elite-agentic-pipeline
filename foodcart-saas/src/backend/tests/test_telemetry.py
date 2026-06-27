"""Tests for the frontend telemetry ingestion endpoint."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app import observability
from main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


class TestTelemetryEndpoint:
    def test_record_telemetry_returns_204(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/telemetry",
            json={"event": "photo_upload_succeeded", "payload": {"duration": 1.2}},
        )
        assert response.status_code == 204
        assert response.content == b""

    def test_record_telemetry_logs_and_increments_metric(self, client: TestClient) -> None:
        provider = observability.NoopMetricsProvider()
        observability._metrics_provider = provider
        observed: dict[str, str] = {}

        def fake_observe(event: str) -> None:
            observed["event"] = event

        monkeypatch = pytest.MonkeyPatch()
        monkeypatch.setattr(provider, "observe_telemetry", fake_observe)

        with patch("app.routers.telemetry.get_logger") as mock_get_logger:
            mock_logger = mock_get_logger.return_value
            response = client.post(
                "/api/v1/telemetry",
                json={
                    "event": "onboarding_step_completed",
                    "payload": {"step": "identity"},
                    "timestamp": "2026-06-27T00:00:00Z",
                },
            )

        assert response.status_code == 204
        assert observed.get("event") == "onboarding_step_completed"
        mock_logger.info.assert_called_once()
        call_kwargs = mock_logger.info.call_args.kwargs
        assert call_kwargs["event_name"] == "onboarding_step_completed"
        assert call_kwargs["timestamp"] == "2026-06-27T00:00:00Z"

        monkeypatch.undo()

    def test_record_telemetry_rejects_invalid_event_name(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/telemetry",
            json={"event": "bad event!"},
        )
        assert response.status_code == 400
        assert response.json()["title"] == "Validation error"

    def test_record_telemetry_requires_event(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/telemetry",
            json={"payload": {"duration": 1.2}},
        )
        assert response.status_code == 400
        assert response.json()["title"] == "Validation error"


class TestTelemetryMetricsProvider:
    def test_prometheus_observe_telemetry_increments_counter(self) -> None:
        provider = observability.PrometheusMetricsProvider()
        with patch.object(provider.TELEMETRY_COUNTER, "labels") as mock_labels:
            provider.observe_telemetry(event="photo_upload_succeeded")
            mock_labels.assert_called_once_with(event="photo_upload_succeeded")
            mock_labels.return_value.inc.assert_called_once_with()

    def test_otel_observe_telemetry_records_counter(self, monkeypatch) -> None:
        monkeypatch.setattr(
            observability.settings, "otel_exporter_otlp_endpoint", "https://otlp.example.com"
        )
        monkeypatch.setattr(observability.settings, "otel_exporter_otlp_headers", "")
        observability._metrics_provider = None

        with patch("app.observability.metrics.set_meter_provider"):
            provider = observability.OtelMetricsProvider()

        with patch.object(provider, "_telemetry_counter") as mock_counter:
            provider.observe_telemetry(event="error_boundary_caught")
            mock_counter.add.assert_called_once_with(1, {"event": "error_boundary_caught"})

    def test_noop_observe_telemetry_is_safe(self) -> None:
        provider = observability.NoopMetricsProvider()
        provider.observe_telemetry(event="any_event")
