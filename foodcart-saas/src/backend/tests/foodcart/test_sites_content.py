"""Tests for site and content block CRUD."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_list_sites(client: TestClient, onboarded):
    response = client.get("/api/v1/sites", headers=onboarded["user"]["headers"])
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["slug"] == onboarded["site"]["slug"]


def test_get_site(client: TestClient, onboarded):
    response = client.get(
        f"/api/v1/sites/{onboarded['site']['id']}",
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 200
    assert response.json()["template_id"] == "custom"


def test_update_site_publish_state(client: TestClient, onboarded):
    response = client.patch(
        f"/api/v1/sites/{onboarded['site']['id']}",
        json={"publish_state": "published"},
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 200
    assert response.json()["publish_state"] == "published"


def test_get_content_blocks(client: TestClient, onboarded):
    response = client.get(
        f"/api/v1/sites/{onboarded['site']['id']}/content",
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 200
    data = response.json()
    assert data["site_id"] == onboarded["site"]["id"]
    assert len(data["blocks"]) == 8
    block_types = {b["block_type"] for b in data["blocks"]}
    assert "hero" in block_types
    assert "menu" in block_types


def test_add_content_block(client: TestClient, onboarded):
    payload = {
        "block_type": "hero",
        "schema_version": "1.0",
        "data": {"headline": "New Hero", "tagline": "Tag"},
        "sort_order": 99,
    }
    response = client.post(
        f"/api/v1/sites/{onboarded['site']['id']}/content/blocks",
        json=payload,
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 201
    data = response.json()
    assert data["block_type"] == "hero"
    assert data["data"]["headline"] == "New Hero"


def test_update_content_block(client: TestClient, onboarded):
    blocks = client.get(
        f"/api/v1/sites/{onboarded['site']['id']}/content",
        headers=onboarded["user"]["headers"],
    ).json()["blocks"]
    hero = next(b for b in blocks if b["block_type"] == "hero")

    response = client.put(
        f"/api/v1/sites/{onboarded['site']['id']}/content/blocks/{hero['id']}",
        json={
            "block_type": "hero",
            "schema_version": "1.0",
            "data": {"headline": "Updated", "tagline": "Tag"},
            "sort_order": 0,
        },
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 200
    assert response.json()["data"]["headline"] == "Updated"


def test_delete_content_block(client: TestClient, onboarded):
    blocks = client.get(
        f"/api/v1/sites/{onboarded['site']['id']}/content",
        headers=onboarded["user"]["headers"],
    ).json()["blocks"]
    hero = next(b for b in blocks if b["block_type"] == "hero")

    response = client.delete(
        f"/api/v1/sites/{onboarded['site']['id']}/content/blocks/{hero['id']}",
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 204

    response = client.get(
        f"/api/v1/sites/{onboarded['site']['id']}/content",
        headers=onboarded["user"]["headers"],
    )
    assert len(response.json()["blocks"]) == 7


def test_invalid_block_data_rejected(client: TestClient, onboarded):
    response = client.post(
        f"/api/v1/sites/{onboarded['site']['id']}/content/blocks",
        json={
            "block_type": "locations",
            "schema_version": "1.0",
            "data": {"locations": [{"timezone": "Invalid/Zone"}]},
            "sort_order": 0,
        },
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 422


def test_create_additional_site(client: TestClient, onboarded):
    response = client.post(
        "/api/v1/sites",
        json={"slug": "second-site", "template_id": "mis-abuelos"},
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 201
    assert response.json()["slug"] == "second-site"


def test_delete_site(client: TestClient, onboarded):
    response = client.delete(
        f"/api/v1/sites/{onboarded['site']['id']}",
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 204
    response = client.get(
        f"/api/v1/sites/{onboarded['site']['id']}",
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 404
