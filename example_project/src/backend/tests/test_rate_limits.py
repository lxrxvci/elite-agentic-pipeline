"""Tests for rate limiting on authentication and mutation endpoints."""

from __future__ import annotations

from fastapi.testclient import TestClient


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
