"""Tests for Clerk JWT validation and integration."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException

from app.auth.clerk import ClerkAuthError, claims_to_user_kwargs, validate_clerk_token
from app.dependencies import get_current_user


def _generate_rsa_keypair() -> tuple[str, str]:
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
        backend=default_backend(),
    )
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")
    public_key = private_key.public_key()
    public_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")
    return private_pem, public_pem


def _make_token(
    private_key: str, claims: dict[str, Any], headers: dict[str, Any] | None = None
) -> str:
    import jwt as pyjwt

    return pyjwt.encode(claims, private_key, algorithm="RS256", headers=headers or {})


@pytest.fixture
def rsa_keypair() -> tuple[str, str]:
    return _generate_rsa_keypair()


@pytest.fixture
def mock_clerk_settings() -> None:
    with patch("app.auth.clerk.settings") as settings_mock:
        settings_mock.clerk_jwks_url = "https://clerk.example.com/.well-known/jwks.json"
        settings_mock.clerk_audience = "elite-backend"
        settings_mock.clerk_issuer = "https://clerk.example.com"
        yield


def test_validate_clerk_token_success(
    rsa_keypair: tuple[str, str], mock_clerk_settings: None
) -> None:
    private_key, public_key = rsa_keypair
    signing_key = MagicMock()
    signing_key.key = public_key

    claims = {
        "sub": "user_123",
        "email": "test@example.com",
        "name": "Test User",
        "aud": "elite-backend",
        "iss": "https://clerk.example.com",
        "exp": datetime.now(UTC) + timedelta(minutes=5),
    }
    token = _make_token(private_key, claims, {"kid": "key-1"})

    with patch("app.auth.clerk._get_signing_key", return_value=signing_key):
        result = validate_clerk_token(token)

    assert result["sub"] == "user_123"
    assert result["email"] == "test@example.com"


def test_validate_clerk_token_expired(
    rsa_keypair: tuple[str, str], mock_clerk_settings: None
) -> None:
    private_key, public_key = rsa_keypair
    signing_key = MagicMock()
    signing_key.key = public_key

    claims = {
        "sub": "user_123",
        "exp": datetime.now(UTC) - timedelta(minutes=5),
        "aud": "elite-backend",
        "iss": "https://clerk.example.com",
    }
    token = _make_token(private_key, claims, {"kid": "key-1"})

    with patch("app.auth.clerk._get_signing_key", return_value=signing_key):
        with pytest.raises(ClerkAuthError, match="expired"):
            validate_clerk_token(token)


def test_validate_clerk_token_missing_jwks_url() -> None:
    with patch("app.auth.clerk.settings") as settings_mock:
        settings_mock.clerk_jwks_url = ""
        with pytest.raises(ClerkAuthError, match="CLERK_JWKS_URL"):
            validate_clerk_token("any-token")


def test_claims_to_user_kwargs() -> None:
    claims = {"sub": "user_123", "email": "test@example.com", "name": "Test User"}
    result = claims_to_user_kwargs(claims)

    assert result["email"] == "test@example.com"
    assert result["name"] == "Test User"
    assert result["clerk_id"] == "user_123"
    assert isinstance(result["id"], uuid.UUID)
    assert isinstance(result["tenant_id"], uuid.UUID)


def test_get_current_user_uses_clerk_when_configured(
    rsa_keypair: tuple[str, str],
    mock_clerk_settings: None,
) -> None:
    private_key, public_key = rsa_keypair
    signing_key = MagicMock()
    signing_key.key = public_key

    claims = {
        "sub": "user_clerk_123",
        "email": "clerk@example.com",
        "name": "Clerk User",
        "aud": "elite-backend",
        "iss": "https://clerk.example.com",
        "exp": datetime.now(UTC) + timedelta(minutes=5),
    }
    token = _make_token(private_key, claims, {"kid": "key-1"})

    credentials = MagicMock()
    credentials.credentials = token

    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None

    with patch("app.dependencies.settings") as dep_settings:
        dep_settings.clerk_jwks_url = "https://clerk.example.com/.well-known/jwks.json"
        dep_settings.clerk_audience = "elite-backend"
        dep_settings.clerk_issuer = "https://clerk.example.com"
        with patch("app.auth.clerk._get_signing_key", return_value=signing_key):
            user = get_current_user(credentials, db)

    assert user.email == "clerk@example.com"
    assert user.name == "Clerk User"


def test_get_current_user_rejects_invalid_clerk_token(mock_clerk_settings: None) -> None:
    credentials = MagicMock()
    credentials.credentials = "not-a-valid-token"

    db = MagicMock()

    with pytest.raises(HTTPException) as exc_info:
        get_current_user(credentials, db)

    assert exc_info.value.status_code == 401


def test_get_current_user_dev_token_in_development() -> None:
    from app.config import settings
    from app.dependencies import create_access_token

    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    token = create_access_token(
        user_id=user_id,
        email="dev@example.com",
        name="Dev",
        tenant_id=tenant_id,
    )

    credentials = MagicMock()
    credentials.credentials = token

    db = MagicMock()
    db_user = MagicMock()
    db_user.id = user_id
    db_user.email = "dev@example.com"
    db_user.name = "Dev"
    db_user.tenant_id = tenant_id
    db.query.return_value.filter.return_value.first.return_value = db_user

    with patch.object(settings, "env", "development"):
        with patch.object(settings, "clerk_jwks_url", ""):
            user = get_current_user(credentials, db)

    assert user.email == "dev@example.com"
    assert user.tenant_id == tenant_id


def test_get_current_user_missing_credentials() -> None:
    db = MagicMock()
    with pytest.raises(HTTPException) as exc_info:
        get_current_user(None, db)
    assert exc_info.value.status_code == 401
