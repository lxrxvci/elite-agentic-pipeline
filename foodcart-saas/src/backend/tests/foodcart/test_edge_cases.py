"""Edge-case coverage tests for Foodcart routers and helpers."""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient


def test_create_site_duplicate_slug(client: TestClient, onboarded):
    response = client.post(
        "/api/v1/sites",
        json={"slug": onboarded["site"]["slug"], "template_id": "banhmi"},
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 409


def test_get_site_not_found(client: TestClient, onboarded):
    response = client.get(
        f"/api/v1/sites/{uuid.uuid4()}",
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 404


def test_update_site_not_found(client: TestClient, onboarded):
    response = client.patch(
        f"/api/v1/sites/{uuid.uuid4()}",
        json={"publish_state": "published"},
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 404


def test_update_site_custom_domain(client: TestClient, onboarded):
    response = client.patch(
        f"/api/v1/sites/{onboarded['site']['id']}",
        json={"custom_domain": "example.com"},
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 200
    assert response.json()["custom_domain"] == "example.com"


def test_delete_site_not_found(client: TestClient, onboarded):
    response = client.delete(
        f"/api/v1/sites/{uuid.uuid4()}",
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 404


def test_get_content_site_not_found(client: TestClient, onboarded):
    response = client.get(
        f"/api/v1/sites/{uuid.uuid4()}/content",
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 404


def test_update_content_block_not_found(client: TestClient, onboarded):
    response = client.put(
        f"/api/v1/sites/{onboarded['site']['id']}/content/blocks/{uuid.uuid4()}",
        json={
            "block_type": "hero",
            "schema_version": "1.0",
            "data": {"headline": "x", "tagline": "y"},
            "sort_order": 0,
        },
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 404


def test_delete_content_block_not_found(client: TestClient, onboarded):
    response = client.delete(
        f"/api/v1/sites/{onboarded['site']['id']}/content/blocks/{uuid.uuid4()}",
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 404


def test_ingestion_social_and_order_links(client: TestClient, onboarded):
    response = client.post(
        f"/api/v1/sites/{onboarded['site']['id']}/ingest",
        json={
            "social_links": [
                {"platform": "instagram", "url": "https://instagram.com/test"},
            ],
            "order_links": [
                {"platform": "doordash", "url": "https://doordash.com/test"},
            ],
        },
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 202
    data = response.json()
    assert len(data) == 1
    assert data[0]["source_type"] == "social_links"


def test_get_ingestion_job_not_found(client: TestClient, onboarded):
    response = client.get(
        f"/api/v1/sites/{onboarded['site']['id']}/ingest/jobs/{uuid.uuid4()}",
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 404


def test_public_preview_site_not_found(client: TestClient):
    response = client.get("/api/v1/public/sites/nonexistent/preview?preview_token=abc")
    assert response.status_code == 404


def test_revert_revision_not_found(client: TestClient, onboarded):
    response = client.post(
        f"/api/v1/sites/{onboarded['site']['id']}/revisions/{uuid.uuid4()}/revert",
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 404


def test_get_me_tenant_not_found(client: TestClient, seeded_user):
    response = client.get("/api/v1/tenants/me", headers=seeded_user["headers"])
    assert response.status_code == 404


def test_onboarding_with_initial_sources(client: TestClient, seeded_user):
    response = client.post(
        "/api/v1/tenants/onboard",
        json={
            "business_name": "Source Truck",
            "slug": "source-truck",
            "template_id": "banhmi",
            "initial_sources": {
                "website_url": "https://example.com",
                "social_links": [
                    {"platform": "instagram", "url": "https://instagram.com/x"},
                ],
                "order_links": [
                    {"platform": "doordash", "url": "https://doordash.com/x"},
                ],
            },
        },
        headers=seeded_user["headers"],
    )
    assert response.status_code == 201
    assert response.json()["tenant"]["slug"] == "source-truck"
