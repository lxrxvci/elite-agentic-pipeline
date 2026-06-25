#!/usr/bin/env python3
"""Canary analysis: compare canary against baseline and SLOs.

The script health-probes the canary and baseline, evaluates production SLOs
(error rate < 0.1%, p95 latency < 300ms), and optionally queries Prometheus for
aggregate metrics.  It exits 0 with a ``PROMOTE`` recommendation when the
canary is healthy, and exits 1 with a ``ROLLBACK`` recommendation otherwise.
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
from dataclasses import asdict, dataclass
from typing import Any
from urllib.error import HTTPError, URLError


@dataclass
class ProbeResult:
    url: str
    total: int
    errors: int
    error_rate: float
    median: float
    p95: float
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


def percentile(sorted_durations: list[float], q: float) -> float:
    if not sorted_durations:
        return 0.0
    idx = int(len(sorted_durations) * q)
    idx = min(idx, len(sorted_durations) - 1)
    return sorted_durations[idx]


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
    p95 = percentile(durations, 0.95)
    p99 = percentile(durations, 0.99)
    median = statistics.median(durations) if durations else 0.0

    print(f"  Requests: {total}, Errors: {errors}, Error rate: {error_rate:.2%}")
    print(f"  Median latency: {median:.3f}s, P95 latency: {p95:.3f}s, P99 latency: {p99:.3f}s")

    return ProbeResult(
        url=url,
        total=total,
        errors=errors,
        error_rate=error_rate,
        median=median,
        p95=p95,
        p99=p99,
    )


def evaluate_slo(
    result: ProbeResult,
    max_error_rate: float,
    max_latency_p95: float,
    max_latency_p99: float,
) -> bool:
    ok = (
        result.error_rate <= max_error_rate
        and result.p95 <= max_latency_p95
        and result.p99 <= max_latency_p99
    )
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
    max_latency_regression_p99: float,
) -> bool:
    """Return True if the canary is not meaningfully worse than the baseline."""
    error_delta = canary.error_rate - baseline.error_rate
    latency_p95_delta = canary.p95 - baseline.p95
    latency_p99_delta = canary.p99 - baseline.p99

    print(f"Baseline vs canary error-rate delta: {error_delta:+.2%}")
    print(f"Baseline vs canary P95 latency delta: {latency_p95_delta:+.3f}s")
    print(f"Baseline vs canary P99 latency delta: {latency_p99_delta:+.3f}s")

    failed = False
    if error_delta > max_error_rate_regression:
        print(
            f"Canary FAILED: error-rate regression ({error_delta:.2%}) "
            f"exceeds limit ({max_error_rate_regression:.2%})."
        )
        failed = True
    if latency_p95_delta > max_latency_regression:
        print(
            f"Canary FAILED: P95 latency regression ({latency_p95_delta:.3f}s) "
            f"exceeds limit ({max_latency_regression:.3f}s)."
        )
        failed = True
    if latency_p99_delta > max_latency_regression_p99:
        print(
            f"Canary FAILED: P99 latency regression ({latency_p99_delta:.3f}s) "
            f"exceeds limit ({max_latency_regression_p99:.3f}s)."
        )
        failed = True

    if failed:
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


def build_queries(metric_prefix: str, window: str) -> dict[str, str]:
    count_metric = f"{metric_prefix}_request_duration_seconds_count"
    bucket_metric = f"{metric_prefix}_request_duration_seconds_bucket"
    return {
        "error_rate": (
            f'sum(rate({count_metric}'
            f'{{status_code=~"5.."}}[{window}]))'
            f' / sum(rate({count_metric}[{window}]))'
        ),
        "latency_p95": (
            f'histogram_quantile(0.95,'
            f' sum(rate({bucket_metric}[{window}])) by (le))'
        ),
        "latency_p99": (
            f'histogram_quantile(0.99,'
            f' sum(rate({bucket_metric}[{window}])) by (le))'
        ),
    }


def check_prometheus(
    args: argparse.Namespace,
    queries: dict[str, str],
) -> tuple[bool, dict[str, float | None]]:
    if not args.prometheus_url:
        return True, {}

    prom_error_rate = query_prometheus(args.prometheus_url, queries["error_rate"])
    prom_p95 = query_prometheus(args.prometheus_url, queries["latency_p95"])
    prom_p99 = query_prometheus(args.prometheus_url, queries["latency_p99"])

    print(f"Prometheus error rate: {prom_error_rate}")
    print(f"Prometheus P95 latency: {prom_p95}")
    print(f"Prometheus P99 latency: {prom_p99}")

    ok = True
    readings: dict[str, float | None] = {
        "error_rate": prom_error_rate,
        "latency_p95": prom_p95,
        "latency_p99": prom_p99,
    }

    if prom_error_rate is None or prom_error_rate > args.max_error_rate:
        print("Canary FAILED: Prometheus error-rate SLO breach.")
        ok = False
    if prom_p95 is None or prom_p95 > args.max_latency_p95:
        print("Canary FAILED: Prometheus P95 latency SLO breach.")
        ok = False
    if prom_p99 is None or prom_p99 > args.max_latency_p99:
        print("Canary FAILED: Prometheus P99 latency SLO breach.")
        ok = False

    if args.business_counter:
        counter_query = f'sum(increase({args.business_counter}[{args.window}]))'
        business_value = query_prometheus(args.prometheus_url, counter_query)
        print(f"Business counter {args.business_counter}: {business_value}")
        readings["business_counter"] = business_value
        if business_value is None or business_value <= 0:
            print("Canary FAILED: business counter did not increase during canary.")
            ok = False

    return ok, readings


def build_summary(
    baseline: ProbeResult | None,
    canary: ProbeResult | None,
    prometheus_readings: dict[str, float | None],
    passed: bool,
) -> dict[str, Any]:
    return {
        "recommendation": "PROMOTE" if passed else "ROLLBACK",
        "baseline": asdict(baseline) if baseline else None,
        "canary": asdict(canary) if canary else None,
        "prometheus": prometheus_readings,
    }


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
        help="Optional backend canary URL to probe",
    )
    parser.add_argument(
        "--baseline-url",
        default="",
        help="Baseline URL to compare the canary against; defaults to --url",
    )
    parser.add_argument("--requests", type=int, default=50)
    parser.add_argument("--concurrency", type=int, default=5)
    parser.add_argument(
        "--max-error-rate",
        type=float,
        default=0.001,
        help="Maximum acceptable error rate (default 0.1%%)",
    )
    parser.add_argument(
        "--max-latency-p95",
        type=float,
        default=0.3,
        help="Maximum acceptable P95 latency in seconds (default 300ms)",
    )
    parser.add_argument(
        "--max-latency-p99",
        type=float,
        default=1.0,
        help="Maximum acceptable P99 latency in seconds",
    )
    parser.add_argument(
        "--max-error-rate-regression",
        type=float,
        default=0.001,
        help="Maximum allowable increase in error rate vs baseline",
    )
    parser.add_argument(
        "--max-latency-regression",
        type=float,
        default=0.2,
        help="Maximum allowable increase in P95 latency vs baseline (seconds)",
    )
    parser.add_argument(
        "--max-latency-regression-p99",
        type=float,
        default=0.5,
        help="Maximum allowable increase in P99 latency vs baseline (seconds)",
    )
    parser.add_argument("--timeout", type=float, default=5.0)
    parser.add_argument(
        "--prometheus-url",
        default="",
        help="Optional Prometheus URL for aggregate SLO/business metrics",
    )
    parser.add_argument("--window", default="5m", help="Prometheus query window")
    parser.add_argument(
        "--business-counter",
        default="",
        help="Optional Prometheus counter name that must be > 0 during canary",
    )
    parser.add_argument(
        "--metric-prefix",
        default="elite",
        help="Prefix for Prometheus request-duration metrics",
    )
    parser.add_argument(
        "--recommend",
        action="store_true",
        help="Print a final PROMOTE/ROLLBACK recommendation",
    )
    parser.add_argument(
        "--output-json",
        action="store_true",
        help="Emit a JSON summary in addition to text output",
    )
    args = parser.parse_args()

    if args.baseline_url and not args.canary_url:
        print("ERROR: --baseline-url requires --canary-url.", file=sys.stderr)
        return 2

    baseline_url = args.baseline_url or args.url
    baseline = probe_url(baseline_url, args.requests, args.concurrency, args.timeout)
    all_ok = evaluate_slo(
        baseline,
        args.max_error_rate,
        args.max_latency_p95,
        args.max_latency_p99,
    )

    canary: ProbeResult | None = None
    if args.canary_url:
        canary = probe_url(args.canary_url, args.requests, args.concurrency, args.timeout)
        all_ok = evaluate_slo(
            canary,
            args.max_error_rate,
            args.max_latency_p95,
            args.max_latency_p99,
        ) and all_ok
        all_ok = compare_to_baseline(
            canary,
            baseline,
            args.max_error_rate_regression,
            args.max_latency_regression,
            args.max_latency_regression_p99,
        ) and all_ok

    queries = build_queries(args.metric_prefix, args.window)
    prom_ok, readings = check_prometheus(args, queries)
    all_ok = prom_ok and all_ok

    summary = build_summary(baseline, canary, readings, all_ok)

    if args.output_json:
        print(json.dumps(summary, indent=2))

    if args.recommend:
        print(f"Recommendation: {summary['recommendation']}")

    if all_ok:
        print("Canary PASSED.")
        return 0

    print("Canary FAILED.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
