"""Tests for public site endpoints."""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app.config import settings
from domain.services.foodcart import sign_preview_token


def test_public_published_site(client: TestClient, onboarded):
    client.patch(
        f"/api/v1/sites/{onboarded['site']['id']}",
        json={"publish_state": "published"},
        headers=onboarded["user"]["headers"],
    )
    response = client.get(f"/api/v1/public/sites/{onboarded['tenant']['slug']}")
    assert response.status_code == 200
    data = response.json()
    assert data["slug"] == onboarded["tenant"]["slug"]
    assert len(data["blocks"]) == 8


def test_public_draft_site_returns_404(client: TestClient, onboarded):
    response = client.get(f"/api/v1/public/sites/{onboarded['tenant']['slug']}")
    assert response.status_code == 404


def test_public_unknown_slug_returns_404(client: TestClient):
    response = client.get("/api/v1/public/sites/does-not-exist")
    assert response.status_code == 404


def test_preview_token_shows_draft(client: TestClient, onboarded):
    site_id = uuid.UUID(onboarded["site"]["id"])
    token = sign_preview_token(site_id, settings.secret_key)
    response = client.get(
        f"/api/v1/public/sites/{onboarded['tenant']['slug']}/preview?preview_token={token}"
    )
    assert response.status_code == 200
    assert response.json()["publish_state"] == "draft"


def test_preview_invalid_token_rejected(client: TestClient, onboarded):
    response = client.get(
        f"/api/v1/public/sites/{onboarded['tenant']['slug']}/preview?preview_token=bad-token"
    )
    assert response.status_code == 401
