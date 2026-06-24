"""Tests for scripts/canary_analysis.py."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

_test_file = Path(__file__).resolve()
_SCRIPTS_DIR = next(
    (p / "scripts" for p in _test_file.parents if (p / "scripts" / "canary_analysis.py").is_file()),
    _test_file.parents[4] / "scripts",
)
sys.path.insert(0, str(_SCRIPTS_DIR))

import canary_analysis  # noqa: E402


def _mock_response(status: int = 200) -> object:
    class MockResponse:
        def getcode(self):
            return status

        def read(self):
            return b"{}"

        def __enter__(self):
            return self

        def __exit__(self, *args: object):
            return False

    return MockResponse()


def _run_main(args: list[str]) -> int:
    with patch.object(sys, "argv", ["canary_analysis.py", *args]):
        return canary_analysis.main()


def test_probe_url_reports_zero_errors_for_healthy_url() -> None:
    with patch("urllib.request.urlopen", return_value=_mock_response(200)):
        result = canary_analysis.probe_url(
            "https://stable.example.com/health", 10, 2, 5.0
        )

    assert result.total == 10
    assert result.errors == 0
    assert result.error_rate == 0.0


def test_probe_url_counts_5xx_as_errors() -> None:
    with patch("urllib.request.urlopen", return_value=_mock_response(500)):
        result = canary_analysis.probe_url(
            "https://canary.example.com/health", 5, 1, 5.0
        )

    assert result.total == 5
    assert result.errors == 5
    assert result.error_rate == 1.0


def test_main_passes_when_both_urls_are_healthy() -> None:
    with patch("urllib.request.urlopen", return_value=_mock_response(200)):
        code = _run_main([
            "--url", "https://stable.example.com/health",
            "--canary-url", "https://canary.example.com/health",
            "--requests", "3",
            "--concurrency", "1",
        ])
    assert code == 0


def test_main_fails_when_canary_url_errors() -> None:
    responses = {
        "https://stable.example.com/health": _mock_response(200),
        "https://canary.example.com/health": _mock_response(500),
    }

    def side_effect(url, **_kwargs: object):
        return responses[str(url)]

    with patch("urllib.request.urlopen", side_effect=side_effect):
        code = _run_main([
            "--url", "https://stable.example.com/health",
            "--canary-url", "https://canary.example.com/health",
            "--requests", "3",
            "--concurrency", "1",
        ])
    assert code == 1
