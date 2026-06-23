"""Pact provider verification for the auth API."""

from __future__ import annotations

from pathlib import Path

import pytest
from pact import Verifier

PACTS_DIR = Path(__file__).parent.parent.parent.parent.parent / "src" / "frontend" / "pacts"
PROVIDER_HOST = "localhost"
PROVIDER_BASE_URL = "http://localhost:8000"


def _setup_dev_auth(**_kwargs: object) -> None:
    """Provider state: dev auth is enabled.

    The backend is started with ``ENV=development`` for contract tests, so the
    dev token endpoint is already available. This handler is a no-op because
    the dev endpoint auto-provisions the test user on first call.
    """


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
    verifier.state_handler({"dev auth is enabled": _setup_dev_auth})
    try:
        verifier.verify()
    except RuntimeError as exc:
        pytest.fail(f"Pact provider verification failed: {exc}")
