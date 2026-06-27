"""Tests for onboarding and tenant endpoints."""

from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from domain.entities import UploadedImage
from infrastructure.repositories import UploadedImageRepository


class TestSlugCheck:
    def test_slug_available(self, client: TestClient):
        response = client.post("/api/v1/tenants/slug/check", json={"slug": "fresh-banhmi"})
        assert response.status_code == 200
        data = response.json()
        assert data["available"] is True
        assert data["normalized_slug"] == "fresh-banhmi"

    def test_slug_reserved(self, client: TestClient):
        response = client.post("/api/v1/tenants/slug/check", json={"slug": "admin"})
        assert response.status_code == 200
        assert response.json()["available"] is False

    def test_slug_invalid(self, client: TestClient):
        response = client.post("/api/v1/tenants/slug/check", json={"slug": "bad_slug!"})
        assert response.status_code == 400


class TestOnboarding:
    def test_onboard_creates_tenant_and_site(self, client: TestClient, foodcart_user):
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
        data = response.json()
        assert data["tenant"]["slug"] == "curry-corner"
        assert data["tenant"]["status"] == "active"
        assert data["site"]["template_id"] == "custom"
        assert data["site"]["brand_colors"]["primary"] == "#e86a33"
        assert data["site"]["publish_state"] == "published"

    def test_onboard_twice_returns_conflict(self, client: TestClient, onboarded):
        response = client.post(
            "/api/v1/tenants/onboard",
            json={
                "business_name": "Another",
                "slug": "another-slug",
                "template_id": "custom",
                "brand_colors": {
                    "primary": "#2563eb",
                    "secondary": "#f5f5f5",
                    "background": "#ffffff",
                },
            },
            headers=onboarded["user"]["headers"],
        )
        assert response.status_code == 409

    def test_onboard_duplicate_slug_returns_conflict(
        self, client: TestClient, foodcart_user, onboarded
    ):
        other = foodcart_user
        response = client.post(
            "/api/v1/tenants/onboard",
            json={
                "business_name": "Copycat",
                "slug": onboarded["tenant"]["slug"],
                "template_id": "custom",
                "brand_colors": {
                    "primary": "#2563eb",
                    "secondary": "#f5f5f5",
                    "background": "#ffffff",
                },
            },
            headers=other["headers"],
        )
        assert response.status_code == 409

    def test_get_current_tenant(self, client: TestClient, onboarded):
        response = client.get(
            "/api/v1/tenants/me", headers=onboarded["user"]["headers"]
        )
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == str(onboarded["user"]["tenant"].id)
        assert data["slug"] == onboarded["tenant"]["slug"]

    def test_get_current_tenant_not_onboarded(self, client: TestClient, foodcart_user):
        response = client.get("/api/v1/tenants/me", headers=foodcart_user["headers"])
        assert response.status_code == 404


@pytest.fixture()
def photo_flag_enabled(monkeypatch):
    from app.routers.foodcart import onboarding as onboarding_router

    def _enabled(flag_key: str, context=None):
        return flag_key == "photo-onboarding-v1"

    monkeypatch.setattr(onboarding_router, "is_feature_enabled", _enabled)


@pytest.fixture()
def uploaded_photo(db: Session, foodcart_user):
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


class TestPhotoDrivenOnboarding:
    def _vision_extraction(self, business_name="Taco Fiesta", location_hints=None):
        return type(
            "VisionExtraction",
            (),
            {
                "business_name": business_name,
                "cuisine_type": "Mexican",
                "visible_text": ["TACO"],
                "location_hints": location_hints or ["Austin, TX"],
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

    def _place_details(self):
        return type(
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

    def test_onboard_with_photo_creates_enriched_site(
        self, client: TestClient, foodcart_user, uploaded_photo, photo_flag_enabled, db
    ):
        with (
            patch("infrastructure.storage.is_storage_configured", return_value=True),
            patch("infrastructure.storage.fetch_object", return_value=b"fake-bytes"),
            patch(
                "infrastructure.llm.vision.analyze_image",
                return_value=self._vision_extraction(),
            ),
            patch(
                "infrastructure.adapters.google_places.find_business",
                return_value=self._place_details(),
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
        data = response.json()
        assert data["tenant"]["slug"] == "taco-fiesta-photo"

        # Refresh image from DB.
        image_repo = UploadedImageRepository(db, foodcart_user["tenant"].id)
        updated_image = image_repo.get(uploaded_photo.id)
        assert updated_image is not None
        assert updated_image.status == "processed"
        assert updated_image.site_id is not None

        # Verify hero image URL was set from the uploaded photo.
        from infrastructure import models

        hero_block = (
            db.query(models.ContentBlock)
            .filter(models.ContentBlock.site_id == updated_image.site_id)
            .filter(models.ContentBlock.block_type == "hero")
            .first()
        )
        assert hero_block is not None
        assert hero_block.data.get("image_url") == "https://cdn.example.com/photo.jpg"
        assert hero_block.data.get("headline") == "Taco Fiesta"

        # Verify contact and locations blocks were enriched from Places.
        contact_block = (
            db.query(models.ContentBlock)
            .filter(models.ContentBlock.site_id == updated_image.site_id)
            .filter(models.ContentBlock.block_type == "contact")
            .first()
        )
        assert contact_block.data.get("phone") == "+1 555-123-4567"
        assert contact_block.data.get("address") == "123 Main St, Austin, TX"

        locations_block = (
            db.query(models.ContentBlock)
            .filter(models.ContentBlock.site_id == updated_image.site_id)
            .filter(models.ContentBlock.block_type == "locations")
            .first()
        )
        assert locations_block.data["locations"][0]["hours"]["monday"] == "09:00-22:00"

    def test_onboard_with_photo_flag_disabled_returns_400(
        self, client: TestClient, foodcart_user, uploaded_photo
    ):
        response = client.post(
            "/api/v1/tenants/onboard",
            json={
                "business_name": "Taco Fiesta",
                "slug": "taco-fiesta-disabled",
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
        assert response.status_code == 400
        assert "not enabled" in response.json()["detail"].lower()

    def test_onboard_with_photo_not_found_returns_400(
        self, client: TestClient, foodcart_user, photo_flag_enabled
    ):
        response = client.post(
            "/api/v1/tenants/onboard",
            json={
                "business_name": "Taco Fiesta",
                "slug": "taco-fiesta-missing",
                "template_id": "custom",
                "brand_colors": {
                    "primary": "#2563eb",
                    "secondary": "#f5f5f5",
                    "background": "#ffffff",
                },
                "photo_image_id": str(uuid.uuid4()),
            },
            headers=foodcart_user["headers"],
        )
        assert response.status_code == 400
        assert "not found" in response.json()["detail"].lower()

    def test_onboard_with_photo_graceful_fallback_when_vision_empty(
        self, client: TestClient, foodcart_user, uploaded_photo, photo_flag_enabled, db
    ):
        with (
            patch("infrastructure.storage.is_storage_configured", return_value=True),
            patch("infrastructure.storage.fetch_object", return_value=b"fake-bytes"),
            patch(
                "infrastructure.llm.vision.analyze_image",
                return_value=type(
                    "VisionExtraction",
                    (),
                    {
                        "business_name": None,
                        "cuisine_type": None,
                        "visible_text": [],
                        "location_hints": [],
                        "confidence": 0.0,
                        "has_signage": False,
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
            ),
        ):
            response = client.post(
                "/api/v1/tenants/onboard",
                json={
                    "business_name": "Original Name",
                    "slug": "taco-fiesta-empty",
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
        image_repo = UploadedImageRepository(db, foodcart_user["tenant"].id)
        updated_image = image_repo.get(uploaded_photo.id)
        assert updated_image.status == "processed"

        from infrastructure import models

        hero_block = (
            db.query(models.ContentBlock)
            .filter(models.ContentBlock.site_id == updated_image.site_id)
            .filter(models.ContentBlock.block_type == "hero")
            .first()
        )
        assert hero_block.data.get("headline") == "Original Name"
        assert hero_block.data.get("image_url") == "https://cdn.example.com/photo.jpg"

    def test_onboard_with_photo_graceful_fallback_when_places_empty(
        self, client: TestClient, foodcart_user, uploaded_photo, photo_flag_enabled, db
    ):
        with (
            patch("infrastructure.storage.is_storage_configured", return_value=True),
            patch("infrastructure.storage.fetch_object", return_value=b"fake-bytes"),
            patch(
                "infrastructure.llm.vision.analyze_image",
                return_value=self._vision_extraction(),
            ),
            patch("infrastructure.adapters.google_places.find_business", return_value=None),
        ):
            response = client.post(
                "/api/v1/tenants/onboard",
                json={
                    "business_name": "Original Name",
                    "slug": "taco-fiesta-no-places",
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
        image_repo = UploadedImageRepository(db, foodcart_user["tenant"].id)
        updated_image = image_repo.get(uploaded_photo.id)
        assert updated_image.status == "processed"

    def test_onboard_with_photo_updates_image_status_to_failed_when_storage_unconfigured(
        self, client: TestClient, foodcart_user, uploaded_photo, photo_flag_enabled, db
    ):
        with patch("infrastructure.storage.is_storage_configured", return_value=False):
            response = client.post(
                "/api/v1/tenants/onboard",
                json={
                    "business_name": "Original Name",
                    "slug": "taco-fiesta-no-storage",
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
        image_repo = UploadedImageRepository(db, foodcart_user["tenant"].id)
        updated_image = image_repo.get(uploaded_photo.id)
        assert updated_image.status == "failed"
