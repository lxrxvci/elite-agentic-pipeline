#!/usr/bin/env python3
"""Evaluate Foodcart SaaS SLOs against a Prometheus endpoint.

The script queries Prometheus for the Cycle-1 SLOs defined in ``docs/SLOs.md``
and exits 0 when all SLOs are healthy.  If any SLO is breached it exits 1 and
prints a ``ROLLBACK`` recommendation (or ``PROMOTE`` when everything passes).

If ``--prometheus-url`` is explicitly empty (``""``) the script is a no-op and
returns success so it can be wired into CI before the metrics stack is available.
When the argument is omitted entirely it defaults to the ``PROMETHEUS_URL``
environment variable, or ``http://prometheus`` for local/testing use.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from urllib.error import URLError


@dataclass
class SloCheck:
    name: str
    promql: str
    threshold: float
    comparator: Callable[[float, float], bool]
    value: float | None = None
    ok: bool = False


def query_prometheus(base_url: str, promql: str) -> float | None:
    url = f"{base_url}/api/v1/query?query={urllib.parse.quote(promql)}"
    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected  # noqa: E501
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


def build_checks(args: argparse.Namespace) -> list[SloCheck]:
    prefix = args.metric_prefix
    window = args.window
    count_metric = f"{prefix}_request_duration_seconds_count"
    bucket_metric = f"{prefix}_request_duration_seconds_bucket"
    ai_bucket_metric = f"{prefix}_ai_request_duration_seconds_bucket"

    availability_query = (
        f'sum(rate({count_metric}'
        f'{{status_code=~"2..|3.."}}[{window}]))'
        f' / sum(rate({count_metric}[{window}]))'
    )
    error_rate_query = (
        f'sum(rate({count_metric}'
        f'{{status_code=~"5.."}}[{window}]))'
        f' / sum(rate({count_metric}[{window}]))'
    )
    latency_p95_query = (
        f'histogram_quantile(0.95,'
        f' sum(rate({bucket_metric}[{window}])) by (le))'
    )
    ai_latency_p95_query = (
        f'histogram_quantile(0.95,'
        f' sum(rate({ai_bucket_metric}[{window}])) by (le))'
    )

    checks: list[SloCheck] = [
        SloCheck(
            name="API availability",
            promql=availability_query,
            threshold=args.availability_threshold,
            comparator=lambda v, t: v >= t,
        ),
        SloCheck(
            name="API error rate",
            promql=error_rate_query,
            threshold=args.error_rate_threshold,
            comparator=lambda v, t: v <= t,
        ),
        SloCheck(
            name="API P95 latency",
            promql=latency_p95_query,
            threshold=args.latency_p95_threshold,
            comparator=lambda v, t: v <= t,
        ),
    ]

    if args.check_ai_latency:
        checks.append(
            SloCheck(
                name="AI assistant P95 latency",
                promql=ai_latency_p95_query,
                threshold=args.ai_latency_p95_threshold,
                comparator=lambda v, t: v <= t,
            )
        )

    if args.saturation_query:
        checks.append(
            SloCheck(
                name="Saturation",
                promql=args.saturation_query,
                threshold=args.saturation_threshold,
                comparator=lambda v, t: v <= t,
            )
        )

    return checks


def check_slo(
    prometheus_url: str, name: str, promql: str, threshold: float, comparator: str
) -> bool:
    """Check a single SLO against Prometheus and return True if healthy."""
    value = query_prometheus(prometheus_url, promql)
    if value is None:
        return True
    if comparator == "lte":
        return value <= threshold
    if comparator == "gte":
        return value >= threshold
    if comparator == "lt":
        return value < threshold
    if comparator == "gt":
        return value > threshold
    raise ValueError(f"Unsupported comparator: {comparator}")


def run_checks(prometheus_url: str, checks: list[SloCheck]) -> bool:
    all_ok = True
    for check in checks:
        check.value = query_prometheus(prometheus_url, check.promql)
        if check.value is None:
            check.ok = False
            all_ok = False
            print(f"{check.name}: FAILED (no data)")
            continue

        check.ok = check.comparator(check.value, check.threshold)
        status = "OK" if check.ok else "FAILED"
        op = ">=" if check.comparator(1.0, 0.0) else "<="
        print(
            f"{check.name}: {check.value:.4f} "
            f"({status}, expected {op} {check.threshold})"
        )
        if not check.ok:
            all_ok = False
    return all_ok


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check SLOs via Prometheus")
    parser.add_argument("--prometheus-url", default=None)
    parser.add_argument("--window", default="5m")
    parser.add_argument(
        "--availability-threshold", type=float, default=0.999
    )
    parser.add_argument("--error-rate-threshold", type=float, default=0.001)
    parser.add_argument("--latency-p95-threshold", type=float, default=0.3)
    parser.add_argument("--ai-latency-p95-threshold", type=float, default=5.0)
    parser.add_argument("--saturation-threshold", type=float, default=0.8)
    parser.add_argument(
        "--saturation-query",
        default="",
        help="PromQL for saturation (omit to skip saturation check)",
    )
    parser.add_argument(
        "--check-ai-latency",
        action="store_true",
        help="Include AI assistant latency SLO check",
    )
    parser.add_argument("--metric-prefix", default="elite")
    parser.add_argument(
        "--recommend",
        action="store_true",
        help="Print a final PROMOTE/ROLLBACK recommendation",
    )
    parser.add_argument(
        "--output-json",
        action="store_true",
        help="Emit a JSON summary of the checks",
    )
    args = parser.parse_args(argv)

    if args.prometheus_url is None:
        args.prometheus_url = os.environ.get("PROMETHEUS_URL", "http://prometheus")

    if not args.prometheus_url:
        print("No Prometheus URL configured; skipping SLO check.")
        if args.recommend:
            print("Recommendation: PROMOTE (SLO check skipped)")
        return 0

    checks = build_checks(args)
    all_ok = run_checks(args.prometheus_url, checks)

    summary = {
        "recommendation": "PROMOTE" if all_ok else "ROLLBACK",
        "checks": [
            {
                "name": c.name,
                "value": c.value,
                "threshold": c.threshold,
                "ok": c.ok,
            }
            for c in checks
        ],
    }

    if args.output_json:
        print(json.dumps(summary, indent=2))

    if args.recommend:
        print(f"Recommendation: {summary['recommendation']}")

    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
