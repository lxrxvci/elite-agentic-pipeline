"""Tests for the AI Website Assistant guardrails and apply flow."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_propose_hero_headline(client: TestClient, onboarded):
    response = client.post(
        f"/api/v1/sites/{onboarded['site']['id']}/ai/propose",
        json={"prompt": "Change hero headline to Summer Specials"},
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 200
    data = response.json()
    assert data["in_scope"] is True
    assert len(data["operations"]) == 1
    assert data["operations"][0]["path"] == "/blocks/hero/data/headline"


def test_propose_billing_request_out_of_scope(client: TestClient, onboarded):
    response = client.post(
        f"/api/v1/sites/{onboarded['site']['id']}/ai/propose",
        json={"prompt": "Change my billing email"},
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 200
    data = response.json()
    assert data["in_scope"] is False
    assert data["operations"] == []


def test_apply_requires_confirmation(client: TestClient, onboarded):
    propose = client.post(
        f"/api/v1/sites/{onboarded['site']['id']}/ai/propose",
        json={"prompt": "Change hero headline to Winter Warmers"},
        headers=onboarded["user"]["headers"],
    ).json()

    response = client.post(
        f"/api/v1/sites/{onboarded['site']['id']}/ai/apply",
        json={"proposal_id": propose["proposal_id"], "confirmed": False},
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 400


def test_apply_creates_revision_and_updates_block(client: TestClient, onboarded):
    propose = client.post(
        f"/api/v1/sites/{onboarded['site']['id']}/ai/propose",
        json={"prompt": "Change hero headline to Fall Favorites"},
        headers=onboarded["user"]["headers"],
    ).json()

    response = client.post(
        f"/api/v1/sites/{onboarded['site']['id']}/ai/apply",
        json={"proposal_id": propose["proposal_id"], "confirmed": True},
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 200
    revision = response.json()
    assert revision["source"] == "ai"
    assert "blocks" in revision["snapshot"]

    blocks = client.get(
        f"/api/v1/sites/{onboarded['site']['id']}/content",
        headers=onboarded["user"]["headers"],
    ).json()["blocks"]
    hero = next(b for b in blocks if b["block_type"] == "hero")
    assert hero["data"]["headline"] == "Fall Favorites"


def test_reapply_same_proposal_fails(client: TestClient, onboarded):
    propose = client.post(
        f"/api/v1/sites/{onboarded['site']['id']}/ai/propose",
        json={"prompt": "Change hero tagline"},
        headers=onboarded["user"]["headers"],
    ).json()

    response = client.post(
        f"/api/v1/sites/{onboarded['site']['id']}/ai/apply",
        json={"proposal_id": propose["proposal_id"], "confirmed": True},
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 200

    response = client.post(
        f"/api/v1/sites/{onboarded['site']['id']}/ai/apply",
        json={"proposal_id": propose["proposal_id"], "confirmed": True},
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 409
