"""Feature flag integration with managed endpoint, Unleash, and env fallback."""

from __future__ import annotations

import json
import logging
import time
import urllib.parse
import urllib.request
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)

PHOTO_ONBOARDING_FLAG = "photo-onboarding-v1"

_unleash_client: Any | None = None
_managed_flags_cache: dict[str, bool] | None = None
_managed_flags_fetched_at: float = 0.0


def _get_unleash_client() -> Any | None:
    """Return a lazily-initialized Unleash client, or None if not configured."""
    global _unleash_client  # noqa: PLW0603
    if _unleash_client is not None:
        return _unleash_client

    if not settings.unleash_url:
        return None

    try:
        from UnleashClient import UnleashClient

        _unleash_client = UnleashClient(
            url=settings.unleash_url,
            app_name=settings.unleash_app_name,
            custom_headers={"Authorization": settings.unleash_api_token},
            refresh_interval=settings.unleash_refresh_interval,
        )
        _unleash_client.initialize_client()
        logger.info("Unleash feature flag client initialized")
        return _unleash_client
    except Exception:
        logger.exception("Failed to initialize Unleash client; falling back to env flags")
        _unleash_client = None
        return None


def _fetch_managed_flags() -> dict[str, bool]:
    """Fetch feature flags from a managed HTTP endpoint.

    The endpoint is expected to return a JSON object mapping flag keys to booleans.
    """
    url = settings.managed_feature_flags_url
    if not url:
        return {}

    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        logger.warning("Invalid feature-flag URL scheme: %s", parsed.scheme)
        return {}

    req = urllib.request.Request(url, method="GET")
    if settings.managed_feature_flags_token:
        req.add_header("Authorization", f"Bearer {settings.managed_feature_flags_token}")

    try:
        # nosemgrep
        with urllib.request.urlopen(req, timeout=10) as response:  # nosec B310
            data = json.loads(response.read().decode("utf-8"))
            if isinstance(data, dict):
                return {str(k): bool(v) for k, v in data.items()}
    except Exception:
        logger.exception("Failed to fetch managed feature flags from %s", url)

    return {}


def _get_managed_flags() -> dict[str, bool] | None:
    """Return cached managed flags, or None if no managed endpoint is configured."""
    global _managed_flags_cache, _managed_flags_fetched_at  # noqa: PLW0603

    if not settings.managed_feature_flags_url:
        return None

    now = time.time()
    ttl = max(settings.unleash_refresh_interval, 15)
    if _managed_flags_cache is None or (now - _managed_flags_fetched_at) > ttl:
        _managed_flags_cache = _fetch_managed_flags()
        _managed_flags_fetched_at = now

    return _managed_flags_cache


def is_feature_enabled(flag_key: str, context: dict[str, Any] | None = None) -> bool:
    """Return True if the feature flag is enabled.

    Resolution order:
    1. Managed feature-flag endpoint (MANAGED_FEATURE_FLAGS_URL)
    2. Unleash (UNLEASH_URL)
    3. Comma-separated ENABLED_FEATURES environment variable
    """
    managed = _get_managed_flags()
    if managed is not None:
        return managed.get(flag_key, False)

    client = _get_unleash_client()
    if client is not None:
        try:
            return bool(client.is_enabled(flag_key, context))
        except Exception:
            logger.exception("Unleash check failed for %s; falling back to env flags", flag_key)

    enabled = {key.strip() for key in settings.enabled_features.split(",") if key.strip()}
    return flag_key in enabled


def shutdown_feature_client() -> None:
    """Gracefully destroy the Unleash client, if initialized."""
    global _unleash_client  # noqa: PLW0603
    if _unleash_client is not None:
        try:
            _unleash_client.destroy()
        except Exception:
            logger.exception("Error shutting down Unleash client")
        finally:
            _unleash_client = None
