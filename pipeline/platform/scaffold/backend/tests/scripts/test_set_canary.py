"""Tests for scripts/set_canary.py."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import patch

_test_file = Path(__file__).resolve()
_SCRIPTS_DIR = next(
    (p / "scripts" for p in _test_file.parents if (p / "scripts" / "set_canary.py").is_file()),
    _test_file.parents[4] / "scripts",
)
sys.path.insert(0, str(_SCRIPTS_DIR))

import set_canary  # noqa: E402


def _mock_response(body: dict) -> object:
    class MockResponse:
        def read(self):
            return json.dumps(body).encode()

        def __enter__(self):
            return self

        def __exit__(self, *args: object):
            return False

    return MockResponse()


def test_set_canary_with_api_url() -> None:
    response = _mock_response({"status": "ok"})
    with patch("urllib.request.urlopen", return_value=response) as mock_urlopen:
        ok = set_canary.set_canary(
            edge_config_id="ec_123",
            percentage=10,
            token="tk_123",
            deployment_url="https://frontend-canary.example.com",
            api_url="https://backend-canary.example.com/api/v1",
        )

    assert ok is True
    assert mock_urlopen.call_count == 1
    req = mock_urlopen.call_args[0][0]
    payload = json.loads(req.data)
    value = payload["items"][0]["value"]
    assert value["percentage"] == 10
    assert value["deploymentUrl"] == "https://frontend-canary.example.com"
    assert value["apiUrl"] == "https://backend-canary.example.com/api/v1"


def test_set_canary_without_api_url_omits_key() -> None:
    response = _mock_response({"status": "ok"})
    with patch("urllib.request.urlopen", return_value=response) as mock_urlopen:
        ok = set_canary.set_canary(
            edge_config_id="ec_123",
            percentage=0,
            token="tk_123",
        )

    assert ok is True
    req = mock_urlopen.call_args[0][0]
    payload = json.loads(req.data)
    value = payload["items"][0]["value"]
    assert value == {"percentage": 0}


def test_set_canary_failure() -> None:
    with patch("urllib.request.urlopen", return_value=_mock_response({"status": "error"})):
        ok = set_canary.set_canary(
            edge_config_id="ec_123",
            percentage=10,
            token="tk_123",
        )

    assert ok is False
