#!/usr/bin/env python3
"""Evaluate SLOs against a Prometheus endpoint after a deployment."""
from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request
from urllib.error import URLError


def query_prometheus(base_url: str, promql: str) -> float | None:
    url = f"{base_url}/api/v1/query?query={urllib.parse.quote(promql)}"
    try:
        # nosemgrep
        with urllib.request.urlopen(url, timeout=10) as response:
            data = json.loads(response.read())
    except URLError as exc:
        print(f"ERROR: failed to query Prometheus: {exc}", file=sys.stderr)
        return None

    result = data.get("data", {}).get("result", [])
    if not result:
        return 0.0
    value = result[0].get("value", [])
    if len(value) < 2:
        return None
    try:
        return float(value[1])
    except (TypeError, ValueError):
        return None


def check_slo(prometheus_url: str, slo_name: str, promql: str, threshold: float, op: str) -> bool:
    value = query_prometheus(prometheus_url, promql)
    if value is None:
        print(f"{slo_name}: FAILED (no data)")
        return False

    ok = (op == "lte" and value <= threshold) or (op == "gte" and value >= threshold)
    status = "OK" if ok else "FAILED"
    print(f"{slo_name}: {value} ({status}, threshold {op} {threshold})")
    return ok


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check SLOs via Prometheus")
    parser.add_argument("--prometheus-url", default="http://localhost:9090")
    parser.add_argument("--window", default="5m")
    parser.add_argument("--max-error-rate", type=float, default=0.01)
    parser.add_argument("--max-latency-p99", type=float, default=0.5)
    args = parser.parse_args(argv)

    window = args.window
    error_rate_query = (
        f'sum(rate(elite_request_duration_seconds_count'
        f'{{status_code=~"5.."}}[{window}]))'
        f' / sum(rate(elite_request_duration_seconds_count[{window}]))'
    )
    latency_query = (
        f'histogram_quantile(0.99,'
        f' sum(rate(elite_request_duration_seconds_bucket[{window}])) by (le))'
    )
    checks = [
        ("HTTP error rate", error_rate_query, args.max_error_rate, "lte"),
        ("P99 latency", latency_query, args.max_latency_p99, "lte"),
    ]

    all_ok = True
    for name, promql, threshold, op in checks:
        if not check_slo(args.prometheus_url, name, promql, threshold, op):
            all_ok = False

    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
