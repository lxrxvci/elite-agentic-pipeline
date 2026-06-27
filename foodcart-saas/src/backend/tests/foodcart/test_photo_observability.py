"""Observability instrumentation tests for the photo onboarding feature."""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import observability
from app.config import settings
from app.routers.foodcart import onboarding as onboarding_router
from app.routers.foodcart import uploads as uploads_router
from domain.entities import UploadedImage
from infrastructure.adapters import google_places
from infrastructure.llm import vision
from infrastructure.repositories import UploadedImageRepository


@pytest.fixture()
def photo_flag_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    def _enabled(flag_key: str, context: dict[str, Any] | None = None) -> bool:
        return flag_key == "photo-onboarding-v1"

    monkeypatch.setattr(uploads_router, "is_feature_enabled", _enabled)
    monkeypatch.setattr(onboarding_router, "is_feature_enabled", _enabled)


@pytest.fixture()
def metrics_provider(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Install a mock metrics provider and patch the module-level getters."""
    provider = MagicMock(spec=observability.NoopMetricsProvider)
    monkeypatch.setattr(observability, "_metrics_provider", provider)
    with patch.object(uploads_router, "get_metrics_provider", return_value=provider):
        with patch.object(onboarding_router, "get_metrics_provider", return_value=provider):
            with patch.object(vision, "get_metrics_provider", return_value=provider):
                with patch.object(google_places, "get_metrics_provider", return_value=provider):
                    yield provider


@pytest.fixture()
def uploaded_photo(db: Session, foodcart_user: dict[str, Any]) -> UploadedImage:
    image = UploadedImage(
        id=uuid.uuid4(),
        tenant_id=foodcart_user["tenant"].id,
        site_id=None,
        storage_key=f"{foodcart_user['tenant'].id}/onboarding/photo.jpg",
        public_url="https://cdn.example.com/photo.jpg",
        content_type="image/jpeg",
        size_bytes=1024,
        status="uploaded",
        metadata={"source": "onboarding"},
    )
    UploadedImageRepository(db, foodcart_user["tenant"].id).create(image)
    db.commit()
    return image


class TestUploadObservability:
    def test_successful_upload_increments_initiated_and_success(
        self,
        client: TestClient,
        foodcart_user: dict[str, Any],
        photo_flag_enabled: None,
        metrics_provider: MagicMock,
    ) -> None:
        fake_url = {
            "upload_url": "https://example.r2.cloudflarestorage.com/test-bucket",
            "fields": {"key": "value"},
            "storage_key": "test-key",
            "public_url": "https://cdn.example.com/test-key",
            "expires_in": 300,
        }
        with (
            patch(
                "infrastructure.storage.create_presigned_upload_url", return_value=fake_url
            ),
            patch("infrastructure.storage.is_storage_configured", return_value=True),
        ):
            response = client.post(
                "/api/v1/uploads/presigned",
                json={"content_type": "image/jpeg", "size_bytes": 1024},
                headers=foodcart_user["headers"],
            )

        assert response.status_code == 201
        tenant_id = str(foodcart_user["tenant"].id)
        metrics_provider.observe_upload.assert_any_call(
            status="initiated", tenant_id=tenant_id
        )
        metrics_provider.observe_upload.assert_any_call(
            status="success", tenant_id=tenant_id
        )
        assert metrics_provider.observe_upload.call_count == 2

    def test_failed_upload_increments_initiated_and_failed(
        self,
        client: TestClient,
        foodcart_user: dict[str, Any],
        photo_flag_enabled: None,
        metrics_provider: MagicMock,
    ) -> None:
        response = client.post(
            "/api/v1/uploads/presigned",
            json={"content_type": "image/jpeg", "size_bytes": 1024},
            headers=foodcart_user["headers"],
        )

        assert response.status_code == 503
        tenant_id = str(foodcart_user["tenant"].id)
        metrics_provider.observe_upload.assert_any_call(
            status="initiated", tenant_id=tenant_id
        )
        metrics_provider.observe_upload.assert_any_call(
            status="failed", tenant_id=tenant_id
        )
        assert metrics_provider.observe_upload.call_count == 2


class TestOnboardingObservability:
    def test_onboarding_without_photo_records_skipped(
        self,
        client: TestClient,
        foodcart_user: dict[str, Any],
        photo_flag_enabled: None,
        metrics_provider: MagicMock,
    ) -> None:
        response = client.post(
            "/api/v1/tenants/onboard",
            json={
                "business_name": "Curry Corner",
                "slug": "curry-corner",
                "template_id": "custom",
                "brand_colors": {
                    "primary": "#e86a33",
                    "secondary": "#1a1a3e",
                    "background": "#fff8e1",
                },
            },
            headers=foodcart_user["headers"],
        )

        assert response.status_code == 201
        tenant_id = str(foodcart_user["tenant"].id)
        metrics_provider.observe_onboarding_completion.assert_called_once_with(
            photo_enabled="True",
            photo_used="skipped",
            tenant_id=tenant_id,
        )

    def test_onboarding_with_photo_records_uploaded_and_enrichment_success(
        self,
        client: TestClient,
        foodcart_user: dict[str, Any],
        uploaded_photo: UploadedImage,
        photo_flag_enabled: None,
        metrics_provider: MagicMock,
    ) -> None:
        vision_extraction = type(
            "VisionExtraction",
            (),
            {
                "business_name": "Taco Fiesta",
                "cuisine_type": "Mexican",
                "visible_text": ["TACO"],
                "location_hints": ["Austin, TX"],
                "confidence": 0.92,
                "has_signage": True,
                "model_dump": lambda self, exclude_none=True: {
                    "business_name": self.business_name,
                    "cuisine_type": self.cuisine_type,
                    "visible_text": self.visible_text,
                    "location_hints": self.location_hints,
                    "confidence": self.confidence,
                    "has_signage": self.has_signage,
                },
            },
        )()
        place_details = type(
            "PlaceDetails",
            (),
            {
                "name": "Taco Fiesta",
                "address": "123 Main St, Austin, TX",
                "phone": "+1 555-123-4567",
                "website": "https://tacofiesta.example",
                "google_maps_url": "https://maps.example/123",
                "hours": {"monday": "09:00-22:00"},
                "photo_references": [],
                "model_dump": lambda self: {
                    "name": self.name,
                    "address": self.address,
                    "phone": self.phone,
                    "website": self.website,
                    "google_maps_url": self.google_maps_url,
                    "hours": self.hours,
                    "photo_references": self.photo_references,
                },
            },
        )()
        with (
            patch("infrastructure.storage.is_storage_configured", return_value=True),
            patch("infrastructure.storage.fetch_object", return_value=b"fake-bytes"),
            patch(
                "infrastructure.llm.vision.analyze_image",
                return_value=vision_extraction,
            ),
            patch(
                "infrastructure.adapters.google_places.find_business",
                return_value=place_details,
            ),
        ):
            response = client.post(
                "/api/v1/tenants/onboard",
                json={
                    "business_name": "Original Name",
                    "slug": "taco-fiesta-photo",
                    "template_id": "custom",
                    "brand_colors": {
                        "primary": "#2563eb",
                        "secondary": "#f5f5f5",
                        "background": "#ffffff",
                    },
                    "photo_image_id": str(uploaded_photo.id),
                },
                headers=foodcart_user["headers"],
            )

        assert response.status_code == 201
        tenant_id = str(foodcart_user["tenant"].id)
        metrics_provider.observe_onboarding_completion.assert_called_once_with(
            photo_enabled="True",
            photo_used="uploaded",
            tenant_id=tenant_id,
        )
        metrics_provider.observe_photo_enrichment.assert_called_once_with(status="success")

    def test_photo_enrichment_failure_records_failed_counter(
        self,
        client: TestClient,
        foodcart_user: dict[str, Any],
        uploaded_photo: UploadedImage,
        photo_flag_enabled: None,
        metrics_provider: MagicMock,
    ) -> None:
        with patch("infrastructure.storage.is_storage_configured", return_value=False):
            response = client.post(
                "/api/v1/tenants/onboard",
                json={
                    "business_name": "Original Name",
                    "slug": "taco-fiesta-failed",
                    "template_id": "custom",
                    "brand_colors": {
                        "primary": "#2563eb",
                        "secondary": "#f5f5f5",
                        "background": "#ffffff",
                    },
                    "photo_image_id": str(uploaded_photo.id),
                },
                headers=foodcart_user["headers"],
            )

        assert response.status_code == 201
        metrics_provider.observe_photo_enrichment.assert_called_once_with(status="failed")


class TestVisionObservability:
    def test_analyze_image_records_duration_and_creates_span(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "gemini_api_key", "fake-key")

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": (
                                    '{"business_name": "Taco Fiesta", "confidence": 0.92, '
                                    '"has_signage": true}'
                                )
                            }
                        ],
                        "role": "model",
                    }
                }
            ]
        }
        mock_response.raise_for_status.return_value = None
        mock_client.__enter__.return_value.post.return_value = mock_response
        mock_client.__exit__.return_value = False

        mock_span = MagicMock()
        provider = MagicMock(spec=observability.NoopMetricsProvider)

        with patch("infrastructure.llm.vision.httpx.Client", return_value=mock_client):
            with patch.object(vision.tracer, "start_as_current_span") as mock_start_span:
                mock_start_span.return_value.__enter__ = MagicMock(return_value=mock_span)
                mock_start_span.return_value.__exit__ = MagicMock(return_value=False)
                with patch.object(vision, "get_metrics_provider", return_value=provider):
                    result = vision.analyze_image(b"fake-bytes", mime_type="image/png")

        assert result.business_name == "Taco Fiesta"
        mock_start_span.assert_called_once_with("vision.analyze_image")
        assert provider.observe_photo_vision_duration.call_count == 1
        assert provider.observe_ai_duration.call_count == 1


class TestGooglePlacesObservability:
    def test_find_business_records_duration_and_creates_span(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "google_places_api_key", "fake-key")

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "places": [
                {
                    "id": "place_123",
                    "displayName": {"text": "Taco Fiesta"},
                    "formattedAddress": "123 Main St, Austin, TX",
                    "regularOpeningHours": {"weekdayDescriptions": []},
                    "photos": [],
                }
            ]
        }
        mock_response.raise_for_status.return_value = None
        mock_client.__enter__.return_value.post.return_value = mock_response
        mock_client.__exit__.return_value = False

        mock_span = MagicMock()
        provider = MagicMock(spec=observability.NoopMetricsProvider)

        with patch(
            "infrastructure.adapters.google_places.httpx.Client", return_value=mock_client
        ):
            with patch.object(
                google_places.tracer, "start_as_current_span"
            ) as mock_start_span:
                mock_start_span.return_value.__enter__ = MagicMock(return_value=mock_span)
                mock_start_span.return_value.__exit__ = MagicMock(return_value=False)
                with patch.object(
                    google_places, "get_metrics_provider", return_value=provider
                ):
                    result = google_places.find_business("Taco Fiesta")

        assert result is not None
        assert result.place_id == "place_123"
        mock_start_span.assert_called_once_with("places.search_places")
        provider.observe_photo_places_duration.assert_called_once()
