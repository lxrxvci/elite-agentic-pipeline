"""Tests for scripts/set_canary.py."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import httpx

_test_file = Path(__file__).resolve()
_SCRIPTS_DIR = next(
    (p / "scripts" for p in _test_file.parents if (p / "scripts" / "set_canary.py").is_file()),
    _test_file.parents[4] / "scripts",
)
sys.path.insert(0, str(_SCRIPTS_DIR))

import set_canary  # noqa: E402


def _mock_response(body: dict, status_code: int = 200) -> httpx.Response:
    return httpx.Response(
        status_code=status_code,
        json=body,
        request=httpx.Request("PATCH", "https://api.vercel.com"),
    )


def test_set_canary_with_api_url() -> None:
    response = _mock_response({"status": "ok"})
    with patch("httpx.patch", return_value=response) as mock_patch:
        ok = set_canary.set_canary(
            edge_config_id="ec_123",
            percentage=10,
            token="tk_123",
            deployment_url="https://frontend-canary.example.com",
            api_url="https://backend-canary.example.com/api/v1",
        )

    assert ok is True
    assert mock_patch.call_count == 1
    call_kwargs = mock_patch.call_args[1]
    payload = call_kwargs["json"]
    value = payload["items"][0]["value"]
    assert value["percentage"] == 10
    assert value["deploymentUrl"] == "https://frontend-canary.example.com"
    assert value["apiUrl"] == "https://backend-canary.example.com/api/v1"


def test_set_canary_without_api_url_omits_key() -> None:
    response = _mock_response({"status": "ok"})
    with patch("httpx.patch", return_value=response) as mock_patch:
        ok = set_canary.set_canary(
            edge_config_id="ec_123",
            percentage=0,
            token="tk_123",
        )

    assert ok is True
    call_kwargs = mock_patch.call_args[1]
    payload = call_kwargs["json"]
    value = payload["items"][0]["value"]
    assert value == {"percentage": 0}


def test_set_canary_failure() -> None:
    response = _mock_response({"status": "error"})
    with patch("httpx.patch", return_value=response):
        ok = set_canary.set_canary(
            edge_config_id="ec_123",
            percentage=10,
            token="tk_123",
        )

    assert ok is False
