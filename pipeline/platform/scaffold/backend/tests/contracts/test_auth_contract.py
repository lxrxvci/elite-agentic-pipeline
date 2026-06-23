"""Pact provider verification for the auth API."""

from __future__ import annotations

from pathlib import Path

import pytest
from pact import Verifier

PACTS_DIR = Path(__file__).parent.parent.parent.parent.parent / "src" / "frontend" / "pacts"
PROVIDER_HOST = "localhost"
PROVIDER_BASE_URL = "http://localhost:8001"


@pytest.mark.skipif(not list(PACTS_DIR.glob("*.json")), reason="No pact contracts found")
def test_auth_provider() -> None:
    """Verify the backend satisfies consumer contracts."""
    verifier = Verifier(
        name="elite-backend",
        host=PROVIDER_HOST,
    )
    for pact in PACTS_DIR.glob("*.json"):
        verifier.add_source(str(pact))
    verifier.add_transport(url=PROVIDER_BASE_URL)
    try:
        verifier.verify()
    except RuntimeError as exc:
        pytest.fail(f"Pact provider verification failed: {exc}")
