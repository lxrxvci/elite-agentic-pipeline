"""Tests for scripts/slo_check.py."""
from __future__ import annotations

import sys
from pathlib import Path
from types import ModuleType
from unittest.mock import patch

_test_file = Path(__file__).resolve()
SCRIPTS_DIR = next(
    (p / "scripts" for p in _test_file.parents if (p / "scripts" / "slo_check.py").is_file()),
    _test_file.parents[3] / "scripts",
)
sys.path.insert(0, str(SCRIPTS_DIR))

slo_check: ModuleType = __import__("slo_check")


def test_check_slo_pass() -> None:
    with patch.object(slo_check, "query_prometheus", return_value=0.005):
        ok = slo_check.check_slo("http://prometheus", "error rate", "up", 0.01, "lte")
    assert ok is True


def test_check_slo_fail() -> None:
    with patch.object(slo_check, "query_prometheus", return_value=0.05):
        ok = slo_check.check_slo("http://prometheus", "error rate", "up", 0.01, "lte")
    assert ok is False


def test_check_slo_no_data() -> None:
    with patch.object(slo_check, "query_prometheus", return_value=0.0):
        ok = slo_check.check_slo("http://prometheus", "error rate", "up", 0.01, "lte")
    assert ok is True  # no data resolves to 0.0


def test_main_all_ok() -> None:
    values = {
        "API availability": 0.9995,
        "API error rate": 0.0005,
        "API P95 latency": 0.15,
    }

    def fake_query(_url: str, promql: str) -> float:
        # Map the PromQL back to a friendly name for the test fixture.
        if "status_code=~\"2..|3..\"" in promql:
            return values["API availability"]
        if "status_code=~\"5..\"" in promql:
            return values["API error rate"]
        return values["API P95 latency"]

    with patch.object(slo_check, "query_prometheus", side_effect=fake_query):
        assert slo_check.main(["--prometheus-url", "http://prometheus"]) == 0


def test_main_breached() -> None:
    def fake_query(_url: str, _promql: str) -> float:
        return 0.5

    with patch.object(slo_check, "query_prometheus", side_effect=fake_query):
        assert slo_check.main(["--prometheus-url", "http://prometheus"]) == 1


def test_main_unreachable_prometheus() -> None:
    with patch.object(slo_check, "query_prometheus", return_value=None):
        assert slo_check.main(["--prometheus-url", "http://prometheus"]) == 1
