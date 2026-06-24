#!/usr/bin/env python3
"""Canary analysis: health probe + optional Prometheus SLO/business metrics.

When a ``--baseline-url`` is provided, the canary URL is compared against the
baseline rather than judged against absolute thresholds alone. This makes the
check robust to environment-specific latency (e.g. Vercel serverless cold
starts) and catches regressions introduced by the canary build.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError


@dataclass
class ProbeResult:
    url: str
    total: int
    errors: int
    error_rate: float
    median: float
    p99: float


def request_once(url: str, timeout: float) -> tuple[float, int | None]:
    start = time.perf_counter()
    status: int | None = None
    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
        with urllib.request.urlopen(url, timeout=timeout) as response:
            status = response.getcode()
    except HTTPError as exc:
        status = exc.code
    except Exception:
        status = None
    duration = time.perf_counter() - start
    return duration, status


def probe_url(url: str, requests: int, concurrency: int, timeout: float) -> ProbeResult:
    print(f"Running {requests} requests against {url}...")
    durations: list[float] = []
    errors = 0
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(request_once, url, timeout) for _ in range(requests)]
        for future in as_completed(futures):
            duration, status = future.result()
            durations.append(duration)
            if status is None or status >= 500:
                errors += 1

    total = len(durations)
    error_rate = errors / total if total else 1.0
    durations.sort()
    p99 = durations[int(len(durations) * 0.99)] if durations else 0.0
    median = statistics.median(durations) if durations else 0.0

    print(f"  Requests: {total}, Errors: {errors}, Error rate: {error_rate:.2%}")
    print(f"  Median latency: {median:.3f}s, P99 latency: {p99:.3f}s")

    return ProbeResult(
        url=url,
        total=total,
        errors=errors,
        error_rate=error_rate,
        median=median,
        p99=p99,
    )


def evaluate_result(result: ProbeResult, max_error_rate: float, max_latency_p99: float) -> bool:
    ok = result.error_rate <= max_error_rate and result.p99 <= max_latency_p99
    if not ok:
        print(f"  FAILED: health-probe SLO breach detected for {result.url}.")
    else:
        print(f"  PASSED: health-probe SLO met for {result.url}.")
    return ok


def compare_to_baseline(
    canary: ProbeResult,
    baseline: ProbeResult,
    max_error_rate_regression: float,
    max_latency_regression: float,
) -> bool:
    """Return True if canary is not meaningfully worse than baseline."""
    error_delta = canary.error_rate - baseline.error_rate
    latency_delta = canary.p99 - baseline.p99

    print(f"Baseline vs canary error-rate delta: {error_delta:+.2%}")
    print(f"Baseline vs canary P99 latency delta: {latency_delta:+.3f}s")

    if error_delta > max_error_rate_regression:
        print(
            f"Canary FAILED: error rate regression ({error_delta:.2%}) "
            f"exceeds limit ({max_error_rate_regression:.2%})."
        )
        return False
    if latency_delta > max_latency_regression:
        print(
            f"Canary FAILED: P99 latency regression ({latency_delta:.3f}s) "
            f"exceeds limit ({max_latency_regression:.3f}s)."
        )
        return False

    print("Canary PASSED baseline comparison.")
    return True


def query_prometheus(base_url: str, promql: str) -> float | None:
    url = f"{base_url}/api/v1/query?query={urllib.parse.quote(promql)}"
    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
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


def check_prometheus(args: argparse.Namespace) -> bool:
    if not args.prometheus_url:
        return True

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

    prom_error_rate = query_prometheus(args.prometheus_url, error_rate_query)
    prom_p99 = query_prometheus(args.prometheus_url, latency_query)

    print(f"Prometheus error rate: {prom_error_rate}")
    print(f"Prometheus P99 latency: {prom_p99}")

    if prom_error_rate is None or prom_error_rate > args.max_error_rate:
        print("Canary FAILED: Prometheus error-rate SLO breach.")
        return False
    if prom_p99 is None or prom_p99 > args.max_latency_p99:
        print("Canary FAILED: Prometheus latency SLO breach.")
        return False

    if args.business_counter:
        counter_query = f'sum(increase({args.business_counter}[{window}]))'
        business_value = query_prometheus(args.prometheus_url, counter_query)
        print(f"Business counter {args.business_counter}: {business_value}")
        if business_value is None or business_value <= 0:
            print("Canary FAILED: business counter did not increase during canary.")
            return False

    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Canary analysis")
    parser.add_argument(
        "--url",
        default="https://elite-backend.example.com/api/v1/health",
        help="Primary URL to probe (production baseline when --canary-url is used)",
    )
    parser.add_argument(
        "--canary-url",
        default="",
        help="Optional backend canary URL to probe in addition to --url",
    )
    parser.add_argument(
        "--baseline-url",
        default="",
        help="Baseline URL to compare the canary against",
    )
    parser.add_argument("--requests", type=int, default=50)
    parser.add_argument("--concurrency", type=int, default=5)
    parser.add_argument("--max-error-rate", type=float, default=0.02)
    parser.add_argument("--max-latency-p99", type=float, default=0.5)
    parser.add_argument(
        "--max-error-rate-regression",
        type=float,
        default=0.05,
        help="Maximum allowable increase in error rate vs baseline",
    )
    parser.add_argument(
        "--max-latency-regression",
        type=float,
        default=0.5,
        help="Maximum allowable increase in P99 latency vs baseline (seconds)",
    )
    parser.add_argument("--timeout", type=float, default=5.0)
    parser.add_argument(
        "--prometheus-url",
        default="",
        help="Optional Prometheus URL for SLO/business metrics",
    )
    parser.add_argument("--window", default="5m", help="Prometheus query window")
    parser.add_argument(
        "--business-counter",
        default="",
        help="Optional Prometheus counter name that must be > 0 during canary",
    )
    args = parser.parse_args()

    if args.baseline_url and not args.canary_url:
        print(
            "ERROR: --baseline-url requires --canary-url.",
            file=sys.stderr,
        )
        return 2

    results = [probe_url(args.url, args.requests, args.concurrency, args.timeout)]
    if args.canary_url:
        results.append(probe_url(args.canary_url, args.requests, args.concurrency, args.timeout))

    all_ok = all(
        evaluate_result(r, args.max_error_rate, args.max_latency_p99) for r in results
    )

    if not all_ok:
        print("Canary FAILED: one or more health-probe targets breached SLO.")
        return 1

    if args.baseline_url and args.canary_url:
        baseline = results[0]
        canary = results[1]
        if not compare_to_baseline(
            canary,
            baseline,
            args.max_error_rate_regression,
            args.max_latency_regression,
        ):
            return 1

    if not check_prometheus(args):
        return 1

    print("Canary PASSED.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
