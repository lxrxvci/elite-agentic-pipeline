#!/usr/bin/env python3
"""Update Vercel Edge Config canary settings.

Usage:
    python scripts/update_edge_config_canary.py \
        --edge-config-id $VERCEL_EDGE_CONFIG_ID \
        --token $VERCEL_TOKEN \
        --percentage 5 \
        [--api-url https://canary-api.example.com/api/v1] \
        [--deployment-url https://canary-frontend.example.com]

Set ``--percentage 0`` to disable canary routing.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from typing import Any


VERCEL_API = "https://api.vercel.com"


def update_edge_config(
    edge_config_id: str,
    token: str,
    percentage: int,
    api_url: str | None,
    deployment_url: str | None,
) -> int:
    canary: dict[str, Any] = {"percentage": percentage}
    if api_url:
        canary["apiUrl"] = api_url
    if deployment_url:
        canary["deploymentUrl"] = deployment_url

    payload = {"items": [{"operation": "upsert", "key": "canary", "value": canary}]}
    data = json.dumps(payload).encode("utf-8")

    url = f"{VERCEL_API}/v1/edge-config/{edge_config_id}/items"
    request = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="PATCH",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            response.read()
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        print(f"ERROR: failed to update Edge Config: {exc.code} {body}", file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"ERROR: failed to reach Vercel API: {exc}", file=sys.stderr)
        return 1

    print(f"Edge Config updated: canary={percentage}%, apiUrl={api_url}, deploymentUrl={deployment_url}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Update Vercel Edge Config canary settings")
    parser.add_argument("--edge-config-id", required=True)
    parser.add_argument("--token", required=True)
    parser.add_argument("--percentage", type=int, required=True)
    parser.add_argument("--api-url")
    parser.add_argument("--deployment-url")
    args = parser.parse_args()

    return update_edge_config(
        args.edge_config_id,
        args.token,
        args.percentage,
        args.api_url,
        args.deployment_url,
    )


if __name__ == "__main__":
    sys.exit(main())
