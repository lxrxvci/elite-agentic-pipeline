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
import urllib.error
import urllib.request
from pathlib import Path


def _build_auth_handler(username: str | None, password: str | None) -> urllib.request.OpenerDirector | None:
    if not username or not password:
        return None
    password_mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
    password_mgr.add_password(None, "", username, password)
    handler = urllib.request.HTTPBasicAuthHandler(password_mgr)
    return urllib.request.build_opener(handler)


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

    req = urllib.request.Request(
        url,
        data=payload.encode("utf-8"),
        headers={"Content-Type": "text/plain; version=0.0.4; charset=utf-8"},
        method="POST",
    )
    opener = _build_auth_handler(username, password)
    try:
        # nosemgrep
        if opener:
            with opener.open(req, timeout=30) as response:
                print(f"Pushed DORA metrics to {url}: {response.status}")
        else:
            with urllib.request.urlopen(req, timeout=30) as response:
                print(f"Pushed DORA metrics to {url}: {response.status}")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        print(f"ERROR: Pushgateway returned {exc.code}: {body}", file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"ERROR: failed to reach Pushgateway: {exc.reason}", file=sys.stderr)
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
