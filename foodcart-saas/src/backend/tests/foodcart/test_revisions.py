"""Tests for revision snapshots and revert."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_revisions_listed_after_ai_apply(client: TestClient, onboarded):
    client.post(
        f"/api/v1/sites/{onboarded['site']['id']}/ai/propose",
        json={"prompt": "Change hero headline to Revert Test"},
        headers=onboarded["user"]["headers"],
    )
    propose = client.post(
        f"/api/v1/sites/{onboarded['site']['id']}/ai/propose",
        json={"prompt": "Change hero headline to Revert Test"},
        headers=onboarded["user"]["headers"],
    ).json()
    client.post(
        f"/api/v1/sites/{onboarded['site']['id']}/ai/apply",
        json={"proposal_id": propose["proposal_id"], "confirmed": True},
        headers=onboarded["user"]["headers"],
    )

    response = client.get(
        f"/api/v1/sites/{onboarded['site']['id']}/revisions",
        headers=onboarded["user"]["headers"],
    )
    assert response.status_code == 200
    assert len(response.json()) == 1


def test_revert_restores_snapshot(client: TestClient, onboarded):
    original = client.get(
        f"/api/v1/sites/{onboarded['site']['id']}/content",
        headers=onboarded["user"]["headers"],
    ).json()["blocks"]
    original_headline = next(b for b in original if b["block_type"] == "hero")["data"]["headline"]

    propose = client.post(
        f"/api/v1/sites/{onboarded['site']['id']}/ai/propose",
        json={"prompt": "Change hero headline to Reverted"},
        headers=onboarded["user"]["headers"],
    ).json()
    apply_resp = client.post(
        f"/api/v1/sites/{onboarded['site']['id']}/ai/apply",
        json={"proposal_id": propose["proposal_id"], "confirmed": True},
        headers=onboarded["user"]["headers"],
    ).json()

    client.post(
        f"/api/v1/sites/{onboarded['site']['id']}/revisions/{apply_resp['id']}/revert",
        headers=onboarded["user"]["headers"],
    )

    blocks = client.get(
        f"/api/v1/sites/{onboarded['site']['id']}/content",
        headers=onboarded["user"]["headers"],
    ).json()["blocks"]
    hero = next(b for b in blocks if b["block_type"] == "hero")
    assert hero["data"]["headline"] == original_headline
