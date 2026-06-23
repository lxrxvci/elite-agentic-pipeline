"""Tests for scripts/slo_check.py."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock, patch
from urllib.error import URLError

SCRIPTS_DIR = Path(__file__).resolve().parents[3] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

slo_check: ModuleType = __import__("slo_check")


def _mock_context_manager(response: MagicMock) -> MagicMock:
    cm = MagicMock()
    cm.__enter__.return_value = response
    cm.__exit__.return_value = None
    return cm


def _mock_response(payload: dict) -> MagicMock:
    response = MagicMock()
    response.read.return_value = json.dumps(payload).encode("utf-8")
    return response


def test_check_slo_pass() -> None:
    payload = {"data": {"result": [{"value": [1234567890, "0.005"]}]}}
    cm = _mock_context_manager(_mock_response(payload))
    with patch("urllib.request.urlopen", return_value=cm):
        ok = slo_check.check_slo("http://prometheus", "error rate", "up", 0.01, "lte")
    assert ok is True


def test_check_slo_fail() -> None:
    payload = {"data": {"result": [{"value": [1234567890, "0.05"]}]}}
    cm = _mock_context_manager(_mock_response(payload))
    with patch("urllib.request.urlopen", return_value=cm):
        ok = slo_check.check_slo("http://prometheus", "error rate", "up", 0.01, "lte")
    assert ok is False


def test_check_slo_no_data() -> None:
    payload = {"data": {"result": []}}
    cm = _mock_context_manager(_mock_response(payload))
    with patch("urllib.request.urlopen", return_value=cm):
        ok = slo_check.check_slo("http://prometheus", "error rate", "up", 0.01, "lte")
    assert ok is True  # no data resolves to 0.0


def test_main_all_ok() -> None:
    payload = {
        "data": {
            "result": [{"value": [1234567890, "0.0"]}],
        },
    }
    cm = _mock_context_manager(_mock_response(payload))
    with patch("urllib.request.urlopen", return_value=cm):
        assert slo_check.main([]) == 0


def test_main_breached() -> None:
    payload = {
        "data": {
            "result": [{"value": [1234567890, "0.5"]}],
        },
    }
    cm = _mock_context_manager(_mock_response(payload))
    with patch("urllib.request.urlopen", return_value=cm):
        assert slo_check.main([]) == 1


def test_main_unreachable_prometheus() -> None:
    with patch("urllib.request.urlopen", side_effect=URLError("connection refused")):
        assert slo_check.main([]) == 1
