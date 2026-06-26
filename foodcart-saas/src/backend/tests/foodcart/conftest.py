"""Fixtures for Foodcart backend tests."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def foodcart_user(seeded_user):
    return seeded_user


@pytest.fixture()
def onboarded(client: TestClient, foodcart_user):
    payload = {
        "business_name": "Taco Fiesta",
        "slug": "taco-fiesta",
        "template_id": "custom",
        "brand_colors": {
            "primary": "#2563eb",
            "secondary": "#f5f5f5",
            "background": "#ffffff",
        },
        "initial_sources": {"website_url": "https://example.com"},
    }
    response = client.post(
        "/api/v1/tenants/onboard", json=payload, headers=foodcart_user["headers"]
    )
    assert response.status_code == 201
    data = response.json()
    return {
        "tenant": data["tenant"],
        "site": data["site"],
        "user": foodcart_user,
    }


@pytest.fixture()
def foodcart_site(onboarded):
    return onboarded["site"]
