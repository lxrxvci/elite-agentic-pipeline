"""Tests for external link ingestion and SSRF protection."""

from __future__ import annotations

from fastapi.testclient import TestClient


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
