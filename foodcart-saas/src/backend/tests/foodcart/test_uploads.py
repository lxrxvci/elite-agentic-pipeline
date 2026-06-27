"""Tests for upload presigned URL endpoint."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def photo_flag_enabled(monkeypatch):
    from app.routers.foodcart import uploads as uploads_router

    def _enabled(flag_key: str, context=None):
        return flag_key == "photo-onboarding-v1"

    monkeypatch.setattr(uploads_router, "is_feature_enabled", _enabled)


def test_presigned_upload_feature_disabled(
    client: TestClient, foodcart_user
):
    response = client.post(
        "/api/v1/uploads/presigned",
        json={
            "content_type": "image/jpeg",
            "size_bytes": 1024,
        },
        headers=foodcart_user["headers"],
    )
    assert response.status_code == 403
    assert "not enabled" in response.json()["detail"]


def test_presigned_upload_storage_not_configured(
    client: TestClient, foodcart_user, photo_flag_enabled
):
    response = client.post(
        "/api/v1/uploads/presigned",
        json={
            "content_type": "image/jpeg",
            "size_bytes": 1024,
        },
        headers=foodcart_user["headers"],
    )
    assert response.status_code == 503
    assert "not configured" in response.json()["detail"]


def test_presigned_upload_invalid_content_type(
    client: TestClient, foodcart_user, photo_flag_enabled
):
    response = client.post(
        "/api/v1/uploads/presigned",
        json={
            "content_type": "image/gif",
            "size_bytes": 1024,
        },
        headers=foodcart_user["headers"],
    )
    assert response.status_code == 400
    assert "content_type" in response.text


def test_presigned_upload_size_too_large(
    client: TestClient, foodcart_user, photo_flag_enabled
):
    response = client.post(
        "/api/v1/uploads/presigned",
        json={
            "content_type": "image/jpeg",
            "size_bytes": 20 * 1024 * 1024,
        },
        headers=foodcart_user["headers"],
    )
    assert response.status_code == 400
    assert "size_bytes" in response.text


def test_presigned_upload_success(
    client: TestClient,
    foodcart_user,
    photo_flag_enabled,
):
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
            json={
                "content_type": "image/jpeg",
                "size_bytes": 1024,
            },
            headers=foodcart_user["headers"],
        )

    assert response.status_code == 201
    data = response.json()
    assert data["upload_url"] == "https://example.r2.cloudflarestorage.com/test-bucket"
    assert data["public_url"] == "https://cdn.example.com/test-key"
    assert "image_id" in data


def test_presigned_upload_with_site_id(
    client: TestClient,
    foodcart_user,
    foodcart_site,
    photo_flag_enabled,
):
    site_id = foodcart_site["id"]
    fake_url = {
        "upload_url": "https://example.r2.cloudflarestorage.com/test-bucket",
        "fields": {"key": "value"},
        "storage_key": f"{foodcart_user['tenant'].id}/{site_id}/test.webp",
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
            json={
                "content_type": "image/webp",
                "size_bytes": 2048,
                "site_id": str(site_id),
            },
            headers=foodcart_user["headers"],
        )

    assert response.status_code == 201
    data = response.json()
    assert site_id in data["storage_key"]
