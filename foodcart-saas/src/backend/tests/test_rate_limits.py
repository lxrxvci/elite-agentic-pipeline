"""Tests for rate limiting on authentication and mutation endpoints."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import settings
from app.dependencies import _TENANT_QUOTA


def test_auth_token_rate_limit(client: TestClient) -> None:
    """The dev token endpoint should be strictly rate limited to 5/minute."""
    for _ in range(5):
        response = client.post("/api/v1/auth/token", json={"email": "rate-limit@example.com"})
        if response.status_code == 429:
            return
        assert response.status_code == 200

    # After 5 requests in the same minute, we expect to be throttled.
    response = client.post("/api/v1/auth/token", json={"email": "rate-limit@example.com"})
    assert response.status_code == 429


def _collect_api_routes(app):
    """Recursively collect APIRoute objects from the app and included routers."""
    from fastapi.routing import APIRoute

    routes = []
    for route in app.routes:
        if isinstance(route, APIRoute):
            routes.append(route)
        elif hasattr(route, "original_router") and hasattr(route.original_router, "routes"):
            routes.extend(_collect_api_routes(route.original_router))
    return routes


def test_mutation_endpoints_have_rate_limit_decorators() -> None:
    """Verify that the limiter decorator is attached to mutation endpoints."""
    from main import app

    # Routes are stored relative to the router prefix; /api/v1 is added by app.include_router.
    mutation_routes = [
        ("POST", "/clients"),
        ("POST", "/projects"),
        ("POST", "/time-entries"),
        ("PATCH", "/time-entries/{time_entry_id}"),
        ("POST", "/invoices"),
        ("POST", "/invoices/{invoice_id}/mark-paid"),
    ]

    routes = _collect_api_routes(app)

    for method, path in mutation_routes:
        route = next(
            (r for r in routes if r.path == path and method in r.methods),
            None,
        )
        assert route is not None, f"Route {method} {path} not found"
        assert hasattr(route.endpoint, "__wrapped__") or hasattr(
            route.endpoint, "limits"
        ), f"Route {method} {path} is not rate limited"


def test_tenant_quota_enforced(client: TestClient, seeded_user) -> None:
    """Mutation endpoints should enforce a per-tenant quota."""
    _TENANT_QUOTA.clear()
    original_limit = settings.tenant_quota_limit
    original_window = settings.tenant_quota_window
    settings.tenant_quota_limit = 2
    settings.tenant_quota_window = 60

    try:
        headers = seeded_user["headers"]

        # First two requests succeed.
        r1 = client.post("/api/v1/clients", headers=headers, json={
            "name": "Quota Client 1",
            "email": "q1@example.com",
            "currency": "USD",
        })
        assert r1.status_code == 201

        r2 = client.post("/api/v1/clients", headers=headers, json={
            "name": "Quota Client 2",
            "email": "q2@example.com",
            "currency": "USD",
        })
        assert r2.status_code == 201

        # Third request exceeds the quota.
        r3 = client.post("/api/v1/clients", headers=headers, json={
            "name": "Quota Client 3",
            "email": "q3@example.com",
            "currency": "USD",
        })
        assert r3.status_code == 429
        assert "quota" in r3.json()["detail"].lower()
    finally:
        settings.tenant_quota_limit = original_limit
        settings.tenant_quota_window = original_window
        _TENANT_QUOTA.clear()
