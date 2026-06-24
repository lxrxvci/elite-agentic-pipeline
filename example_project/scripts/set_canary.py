#!/usr/bin/env python3
"""Update the Vercel Edge Config canary percentage.

This is used by the deploy pipeline to shift real traffic between the stable
production deployment and a canary deployment. The frontend edge middleware
reads the `canary` key from Edge Config and rewrites a percentage of requests
accordingly. When `apiUrl` is set, canary API requests are routed to the
backend canary via a cookie.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request


def set_canary(
    edge_config_id: str,
    percentage: int,
    token: str,
    deployment_url: str | None = None,
    api_url: str | None = None,
    team_id: str | None = None,
) -> bool:
    value: dict[str, object] = {"percentage": percentage}
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

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="PATCH",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            body = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        print(f"HTTP error {exc.code}: {exc.read().decode()}", file=sys.stderr)
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Update Edge Config canary percentage")
    parser.add_argument("--percentage", type=int, required=True)
    parser.add_argument("--deployment-url", default="")
    parser.add_argument("--api-url", default="")
    parser.add_argument("--edge-config-id", default=os.getenv("VERCEL_EDGE_CONFIG_ID"))
    parser.add_argument("--vercel-token", default=os.getenv("VERCEL_TOKEN"))
    parser.add_argument("--team-id", default=os.getenv("VERCEL_TEAM_ID"))
    args = parser.parse_args()

    if not args.edge_config_id:
        print("VERCEL_EDGE_CONFIG_ID is required", file=sys.stderr)
        return 1
    if not args.vercel_token:
        print("VERCEL_TOKEN is required", file=sys.stderr)
        return 1

    ok = set_canary(
        edge_config_id=args.edge_config_id,
        percentage=args.percentage,
        token=args.vercel_token,
        deployment_url=args.deployment_url or None,
        api_url=args.api_url or None,
        team_id=args.team_id or None,
    )
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
