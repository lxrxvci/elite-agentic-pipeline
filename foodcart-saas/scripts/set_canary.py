#!/usr/bin/env python3
"""Update the Vercel Edge Config canary percentage with optional health checks.

The script is used by the deploy pipeline to shift real traffic between the
stable production deployment and a canary deployment.  It can optionally run a
health probe and query Prometheus before/after the shift so it recommends
``PROMOTE`` when metrics look good or ``ROLLBACK`` when SLOs are breached.

When ``--api-url`` is set, canary API requests are routed to the backend canary
via the Edge Config ``canary.apiUrl`` value.  Set ``--percentage 0`` to disable
canary routing.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from typing import Any

import httpx

from canary_analysis import (
    build_queries,
    evaluate_slo,
    probe_url,
    query_prometheus,
)


def set_canary(
    edge_config_id: str,
    percentage: int,
    token: str,
    deployment_url: str | None = None,
    api_url: str | None = None,
    team_id: str | None = None,
) -> bool:
    value: dict[str, Any] = {"percentage": percentage}
    if deployment_url:
        value["deploymentUrl"] = deployment_url
    if api_url:
        value["apiUrl"] = api_url

    payload = {
        "items": [
            {
                "operation": "upsert",
                "key": "canary",
                "value": value,
            }
        ]
    }

    url = f"https://api.vercel.com/v1/edge-config/{edge_config_id}/items"
    if team_id:
        url = f"{url}?teamId={team_id}"

    try:
        response = httpx.patch(
            url,
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
        response.raise_for_status()
        body = response.json()
    except httpx.HTTPStatusError as exc:
        print(f"HTTP error {exc.response.status_code}: {exc.response.text}", file=sys.stderr)
        return False
    except Exception as exc:  # pragma: no cover - network failures
        print(f"Failed to update Edge Config: {exc}", file=sys.stderr)
        return False

    if body.get("status") != "ok":
        print(f"Unexpected response: {body}", file=sys.stderr)
        return False

    print(f"Canary set to {percentage}%", end="")
    if deployment_url:
        print(f" routing frontend to {deployment_url}", end="")
    if api_url:
        print(f" routing API to {api_url}", end="")
    print()
    return True


def check_health(
    url: str,
    requests: int,
    concurrency: int,
    timeout: float,
    max_error_rate: float,
    max_latency_p95: float,
    max_latency_p99: float,
) -> tuple[bool, Any]:
    print(f"Health check: {url}")
    result = probe_url(url, requests, concurrency, timeout)
    ok = evaluate_slo(result, max_error_rate, max_latency_p95, max_latency_p99)
    return ok, result


def check_prometheus(
    prometheus_url: str,
    window: str,
    metric_prefix: str,
    max_error_rate: float,
    max_latency_p95: float,
) -> bool:
    print(f"Checking Prometheus SLOs: {prometheus_url}")
    queries = build_queries(metric_prefix, window)
    error_rate = query_prometheus(prometheus_url, queries["error_rate"])
    latency_p95 = query_prometheus(prometheus_url, queries["latency_p95"])
    print(f"  Error rate: {error_rate}, P95 latency: {latency_p95}")

    ok = True
    if error_rate is None or error_rate > max_error_rate:
        print(f"  FAILED: error rate {error_rate} > {max_error_rate}")
        ok = False
    if latency_p95 is None or latency_p95 > max_latency_p95:
        print(f"  FAILED: P95 latency {latency_p95} > {max_latency_p95}")
        ok = False
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Update Edge Config canary percentage with optional SLO checks",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--percentage", type=int, required=True)
    parser.add_argument("--deployment-url", default="")
    parser.add_argument("--api-url", default="")
    parser.add_argument("--edge-config-id", default=os.getenv("VERCEL_EDGE_CONFIG_ID"))
    parser.add_argument("--vercel-token", default=os.getenv("VERCEL_TOKEN"))
    parser.add_argument("--team-id", default=os.getenv("VERCEL_TEAM_ID"))
    parser.add_argument(
        "--check-url",
        default="",
        help="Health endpoint to probe before and after the change",
    )
    parser.add_argument("--check-requests", type=int, default=20)
    parser.add_argument("--check-concurrency", type=int, default=5)
    parser.add_argument("--check-timeout", type=float, default=5.0)
    parser.add_argument("--max-error-rate", type=float, default=0.001)
    parser.add_argument("--max-latency-p95", type=float, default=0.3)
    parser.add_argument("--max-latency-p99", type=float, default=1.0)
    parser.add_argument(
        "--prometheus-url",
        default="",
        help="Optional Prometheus URL for pre/post SLO checks",
    )
    parser.add_argument("--window", default="5m")
    parser.add_argument("--metric-prefix", default="elite")
    parser.add_argument(
        "--require-healthy",
        action="store_true",
        help="Abort without changing Edge Config if pre-checks fail",
    )
    parser.add_argument(
        "--auto-rollback",
        action="store_true",
        help="Revert canary to 0%% if the post-check fails",
    )
    args = parser.parse_args()

    if not args.edge_config_id:
        print("VERCEL_EDGE_CONFIG_ID is required", file=sys.stderr)
        return 1
    if not args.vercel_token:
        print("VERCEL_TOKEN is required", file=sys.stderr)
        return 1

    # Pre-checks before touching Edge Config.
    pre_ok = True
    if args.check_url:
        ok, _ = check_health(
            args.check_url,
            args.check_requests,
            args.check_concurrency,
            args.check_timeout,
            args.max_error_rate,
            args.max_latency_p95,
            args.max_latency_p99,
        )
        pre_ok = pre_ok and ok
    if args.prometheus_url:
        ok = check_prometheus(
            args.prometheus_url,
            args.window,
            args.metric_prefix,
            args.max_error_rate,
            args.max_latency_p95,
        )
        pre_ok = pre_ok and ok

    if not pre_ok and args.require_healthy:
        print("Recommendation: ROLLBACK (pre-check failed; Edge Config not modified)")
        return 1

    ok = set_canary(
        edge_config_id=args.edge_config_id,
        percentage=args.percentage,
        token=args.vercel_token,
        deployment_url=args.deployment_url or None,
        api_url=args.api_url or None,
        team_id=args.team_id or None,
    )
    if not ok:
        print("Recommendation: ROLLBACK (failed to update Edge Config)")
        return 1

    # Give the edge a moment to propagate before post-checking.
    if args.check_url and args.percentage > 0:
        time.sleep(5)
        ok, _ = check_health(
            args.check_url,
            args.check_requests,
            args.check_concurrency,
            args.check_timeout,
            args.max_error_rate,
            args.max_latency_p95,
            args.max_latency_p99,
        )
        if not ok:
            print("Post-check FAILED.")
            if args.auto_rollback and args.percentage > 0:
                print("Auto-rolling back canary to 0%...")
                set_canary(
                    edge_config_id=args.edge_config_id,
                    percentage=0,
                    token=args.vercel_token,
                    team_id=args.team_id or None,
                )
            print("Recommendation: ROLLBACK")
            return 1

    print("Recommendation: PROMOTE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
