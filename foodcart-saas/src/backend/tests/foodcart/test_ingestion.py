"""Tests for external link ingestion and SSRF protection."""

from __future__ import annotations

import uuid
from unittest.mock import patch

from fastapi.testclient import TestClient

from domain.entities import IngestionJob, IngestionJobStatus, IngestionSourceType
from domain.services.foodcart import run_ingestion_job


def test_trigger_ingestion_creates_jobs(client: TestClient, onboarded):
    response = client.post(
        f"/api/v1/sites/{onboarded['site']['id']}/ingest",
        json={
            "website_url": "https://example.com",
            "menu_url": "https://example.com/menu",
        },
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 202
    jobs = response.json()
    assert len(jobs) == 2
    assert all(j["status"] in {"completed", "failed"} for j in jobs)


def test_ingestion_ssrf_blocked(client: TestClient, onboarded):
    response = client.post(
        f"/api/v1/sites/{onboarded['site']['id']}/ingest",
        json={"website_url": "http://localhost:8000/admin"},
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 202
    jobs = response.json()
    assert jobs[0]["status"] == "failed"
    assert "Private" in jobs[0]["errors"][0] or "internal" in jobs[0]["errors"][0].lower()


def test_list_and_get_ingestion_jobs(client: TestClient, onboarded):
    trigger = client.post(
        f"/api/v1/sites/{onboarded['site']['id']}/ingest",
        json={"website_url": "https://example.com"},
        headers=onboarded["user"]["headers"],
    ).json()
    job_id = trigger[0]["id"]

    response = client.get(
        f"/api/v1/sites/{onboarded['site']['id']}/ingest/jobs",
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 200
    assert any(j["id"] == job_id for j in response.json())

    response = client.get(
        f"/api/v1/sites/{onboarded['site']['id']}/ingest/jobs/{job_id}",
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 200
    assert response.json()["id"] == job_id


class TestPhotoVisionIngestion:
    def test_photo_vision_job_extracts_business_signals(self):
        job = IngestionJob(
            id=uuid.uuid4(),
            site_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            source_type=IngestionSourceType.PHOTO_VISION,
            source_url="onboarding-photo",
            status=IngestionJobStatus.PENDING,
            raw_payload={"storage_key": "tenant/onboarding/photo.jpg", "mime_type": "image/jpeg"},
        )

        with (
            patch("infrastructure.storage.fetch_object", return_value=b"fake-bytes") as mock_fetch,
            patch(
                "infrastructure.llm.vision.analyze_image",
                return_value=type(
                    "VisionExtraction",
                    (),
                    {
                        "business_name": "Taco Fiesta",
                        "cuisine_type": "Mexican",
                        "visible_text": ["TACO"],
                        "location_hints": ["Austin"],
                        "confidence": 0.9,
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
                )(),
            ) as mock_analyze,
        ):
            result = run_ingestion_job(job)

        assert result.status == IngestionJobStatus.COMPLETED
        assert result.normalized_data["business_name"] == "Taco Fiesta"
        assert result.normalized_data["cuisine_type"] == "Mexican"
        mock_fetch.assert_called_once_with("tenant/onboarding/photo.jpg")
        mock_analyze.assert_called_once_with(b"fake-bytes", mime_type="image/jpeg")

    def test_photo_vision_job_fails_when_storage_not_configured(self):
        job = IngestionJob(
            id=uuid.uuid4(),
            site_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            source_type=IngestionSourceType.PHOTO_VISION,
            source_url="onboarding-photo",
            status=IngestionJobStatus.PENDING,
            raw_payload={"storage_key": "tenant/onboarding/photo.jpg"},
        )

        with patch(
            "infrastructure.storage.fetch_object",
            side_effect=RuntimeError("Storage not configured"),
        ):
            result = run_ingestion_job(job)

        assert result.status == IngestionJobStatus.FAILED
        assert "Storage not configured" in result.errors[0]


class TestGooglePlacesIngestion:
    def test_google_places_job_enriches_business_details(self):
        job = IngestionJob(
            id=uuid.uuid4(),
            site_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            source_type=IngestionSourceType.GOOGLE_PLACES,
            source_url="Taco Fiesta",
            status=IngestionJobStatus.PENDING,
            raw_payload={"business_name": "Taco Fiesta", "location_hints": ["Austin, TX"]},
        )

        fake_place = type(
            "PlaceDetails",
            (),
            {
                "name": "Taco Fiesta",
                "address": "123 Main St, Austin, TX",
                "phone": "+1 555-123-4567",
                "website": "https://tacofiesta.example",
                "google_maps_url": "https://maps.example/123",
                "hours": {"monday": "09:00-22:00"},
                "model_dump": lambda self: {
                    "name": self.name,
                    "address": self.address,
                    "phone": self.phone,
                    "website": self.website,
                    "google_maps_url": self.google_maps_url,
                    "hours": self.hours,
                },
            },
        )()

        with patch(
            "infrastructure.adapters.google_places.find_business",
            return_value=fake_place,
        ) as mock_find:
            result = run_ingestion_job(job)

        assert result.status == IngestionJobStatus.COMPLETED
        assert result.normalized_data["name"] == "Taco Fiesta"
        assert result.normalized_data["address"] == "123 Main St, Austin, TX"
        assert result.normalized_data["hours"]["monday"] == "09:00-22:00"
        assert result.normalized_data["google_business_url"] == "https://maps.example/123"
        mock_find.assert_called_once_with(name="Taco Fiesta", location_hints=["Austin, TX"])

    def test_google_places_job_returns_empty_when_no_match(self):
        job = IngestionJob(
            id=uuid.uuid4(),
            site_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            source_type=IngestionSourceType.GOOGLE_PLACES,
            source_url="Unknown Business",
            status=IngestionJobStatus.PENDING,
            raw_payload={"business_name": "Unknown Business"},
        )

        with patch("infrastructure.adapters.google_places.find_business", return_value=None):
            result = run_ingestion_job(job)

        assert result.status == IngestionJobStatus.COMPLETED
        assert result.normalized_data == {}
