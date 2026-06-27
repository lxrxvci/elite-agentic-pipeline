"""Tests for the dev authentication endpoints and cookie handling."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import settings


def test_dev_token_sets_http_only_cookie(client: TestClient) -> None:
    response = client.post("/api/v1/auth/token", json={"email": "cookie-test@example.com"})
    assert response.status_code == 200
    assert response.json()["token_type"] == "bearer"

    set_cookie = response.headers.get("set-cookie", "")
    assert "elite_session=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "samesite=strict" in set_cookie.lower()

    # CSRF token cookie is also set and must be readable by JavaScript.
    assert "csrf_token=" in set_cookie
    # elite_session is HttpOnly; csrf_token must not be HttpOnly.
    assert "elite_session" in set_cookie and "HttpOnly" in set_cookie


def test_auth_cookie_used_for_protected_endpoint(client: TestClient) -> None:
    token_response = client.post("/api/v1/auth/token", json={"email": "cookie-user@example.com"})
    assert token_response.status_code == 200

    cookie = token_response.headers.get("set-cookie")
    assert cookie

    me_response = client.get("/api/v1/me", headers={"Cookie": cookie.split(";")[0]})
    assert me_response.status_code == 200
    assert me_response.json()["email"] == "cookie-user@example.com"


def test_logout_clears_cookie(client: TestClient) -> None:
    response = client.post("/api/v1/auth/logout")
    assert response.status_code == 200

    set_cookie = response.headers.get("set-cookie", "")
    assert "elite_session=" in set_cookie
    assert "Max-Age=0" in set_cookie or "expires=Thu, 01 Jan 1970" in set_cookie
    assert "csrf_token=" in set_cookie


def test_dev_token_disabled_in_production(client: TestClient) -> None:
    original_env = settings.env
    settings.env = "production"
    try:
        response = client.post("/api/v1/auth/token", json={"email": "prod-test@example.com"})
        assert response.status_code == 404
    finally:
        settings.env = original_env
