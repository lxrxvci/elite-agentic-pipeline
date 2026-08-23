"""Pact provider verification for the auth API."""

from __future__ import annotations

import contextlib
import threading
import time
from collections.abc import Generator
from pathlib import Path

import pytest
import uvicorn
from pact import Verifier

PROVIDER_HOST = "127.0.0.1"
PROVIDER_PORT = 8765
PROVIDER_BASE_URL = f"http://{PROVIDER_HOST}:{PROVIDER_PORT}"
PACTS_DIR = Path(__file__).parent.parent.parent.parent.parent / "src" / "frontend" / "pacts"


def _wait_for_server(url: str, timeout: float = 10.0) -> None:
    """Poll the server until it responds or timeout is reached."""
    import urllib.request

    deadline = time.time() + timeout
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{url}/health", timeout=1):
                return
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            time.sleep(0.1)
    msg = f"Server did not start within {timeout}s"
    raise RuntimeError(msg) from last_error


@contextlib.contextmanager
def _running_backend() -> Generator[str, None, None]:
    """Start the FastAPI app in-process and yield its base URL."""
    config = uvicorn.Config(
        "main:app",
        host=PROVIDER_HOST,
        port=PROVIDER_PORT,
        log_level="warning",
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    try:
        _wait_for_server(PROVIDER_BASE_URL)
        yield PROVIDER_BASE_URL
    finally:
        server.should_exit = True
        thread.join(timeout=5)


def _setup_dev_auth(**_kwargs: object) -> None:
    """Provider state: dev auth is enabled.

    The backend is started with ``ENV=development`` for contract tests, so the
    dev token endpoint is already available. This handler is a no-op because
    the dev endpoint auto-provisions the test user on first call.
    """


@pytest.mark.skipif(not list(PACTS_DIR.glob("*.json")), reason="No pact contracts found")
def test_auth_provider() -> None:
    """Verify the backend satisfies consumer contracts."""
    with _running_backend() as base_url:
        verifier = Verifier(name="elite-backend", host=PROVIDER_HOST)
        for pact in PACTS_DIR.glob("*.json"):
            verifier.add_source(str(pact))
        verifier.add_transport(url=base_url)
        verifier.state_handler({"dev auth is enabled": _setup_dev_auth})
        try:
            verifier.verify()
        except RuntimeError as exc:
            pytest.fail(f"Pact provider verification failed: {exc}")
