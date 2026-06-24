#!/usr/bin/env python3
"""Push DORA metrics from a Prometheus exposition file to a Pushgateway.

Usage:
    python scripts/dora_pushgateway.py \
        --input dora-metrics.prom \
        --pushgateway-url http://localhost:9091 \
        --job dora-metrics \
        --instance github-actions

For a Pushgateway protected by basic auth, set the env vars or pass:
    --username dora \
    --password "$DORA_PUSHGATEWAY_PASSWORD"
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import httpx


def push_metrics(
    input_path: Path,
    pushgateway_url: str,
    job: str,
    instance: str | None,
    username: str | None,
    password: str | None,
) -> int:
    payload = input_path.read_text(encoding="utf-8")
    if not payload.strip():
        print(f"ERROR: {input_path} is empty", file=sys.stderr)
        return 1

    url = f"{pushgateway_url.rstrip('/')}/metrics/job/{job}"
    if instance:
        url = f"{url}/instance/{instance}"

    auth = (username, password) if username and password else None
    try:
        response = httpx.post(
            url,
            content=payload,
            headers={"Content-Type": "text/plain; version=0.0.4; charset=utf-8"},
            auth=auth,
            timeout=30,
        )
        response.raise_for_status()
        print(f"Pushed DORA metrics to {url}: {response.status_code}")
    except httpx.HTTPStatusError as exc:
        print(
            f"ERROR: Pushgateway returned {exc.response.status_code}: {exc.response.text}",
            file=sys.stderr,
        )
        return 1
    except httpx.RequestError as exc:
        print(f"ERROR: failed to reach Pushgateway: {exc}", file=sys.stderr)
        return 1

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Push DORA metrics to a Pushgateway")
    parser.add_argument("--input", type=Path, default=Path("dora-metrics.prom"))
    parser.add_argument("--pushgateway-url", default="http://localhost:9091")
    parser.add_argument("--job", default="dora-metrics")
    parser.add_argument("--instance", default=None)
    parser.add_argument("--username", default=None)
    parser.add_argument("--password", default=None)
    args = parser.parse_args()
    return push_metrics(
        args.input,
        args.pushgateway_url,
        args.job,
        args.instance,
        args.username,
        args.password,
    )


if __name__ == "__main__":
    sys.exit(main())
