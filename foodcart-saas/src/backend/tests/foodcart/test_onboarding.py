"""Tests for onboarding and tenant endpoints."""

from __future__ import annotations

from fastapi.testclient import TestClient


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
