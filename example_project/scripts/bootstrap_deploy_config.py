#!/usr/bin/env python3
"""Bootstrap GitHub secrets and variables needed for Vercel deploy workflows.

This script uses the GitHub CLI (`gh`) to set repository-level secrets and
variables. It generates secure defaults for `CI_SECRET_KEY` and per-environment
`SECRET_KEY` values when they are not provided.

Usage:
    python scripts/bootstrap_deploy_config.py

Requirements:
    - `gh` CLI installed and authenticated.
    - Run from inside the example_project directory (or any project generated
      from the Elite Agentic scaffold).
"""

from __future__ import annotations

import getpass
import secrets
import subprocess
import sys
from typing import Any


def _run(cmd: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
    """Run a command and return the result, raising on failure."""
    return subprocess.run(
        cmd,
        check=True,
        text=True,
        capture_output=True,
        **kwargs,
    )


def _set_secret(name: str, value: str, env: str | None = None) -> None:
    """Set a GitHub secret using stdin to avoid leaking it in process lists."""
    args = ["gh", "secret", "set", name]
    if env:
        args.extend(["--env", env])
    _run(args, input=value)
    scope = f"environment '{env}'" if env else "repository"
    print(f"  ✓ Set secret {name} at {scope}")


def _set_variable(name: str, value: str, env: str | None = None) -> None:
    """Set a GitHub variable."""
    args = ["gh", "variable", "set", name, "--body", value]
    if env:
        args.extend(["--env", env])
    _run(args)
    scope = f"environment '{env}'" if env else "repository"
    print(f"  ✓ Set variable {name} at {scope}")


def _prompt_required(prompt: str) -> str:
    """Prompt for a required value."""
    while True:
        value = input(f"{prompt}: ").strip()
        if value:
            return value
        print("  This value is required.")


def _prompt_secret(prompt: str) -> str:
    """Prompt for a secret value without echoing it."""
    while True:
        value = getpass.getpass(f"{prompt}: ").strip()
        if value:
            return value
        print("  This value is required.")


def _prompt_optional(prompt: str) -> str | None:
    """Prompt for an optional value, returning None if blank."""
    value = input(f"{prompt} (optional): ").strip()
    return value or None


def _generate_key(length: int = 48) -> str:
    """Generate a URL-safe random key."""
    return secrets.token_urlsafe(length)


def _verify_gh() -> str:
    """Verify gh is installed/authenticated and return the repo nameWithOwner."""
    try:
        _run(["gh", "auth", "status"])
    except FileNotFoundError as exc:
        raise RuntimeError(
            "GitHub CLI (`gh`) is not installed. Install it from https://cli.github.com/"
        ) from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(
            "GitHub CLI is not authenticated. Run `gh auth login` first."
        ) from exc

    result = _run(["gh", "repo", "view", "--json", "nameWithOwner"])
    import json

    return str(json.loads(result.stdout)["nameWithOwner"])


def main() -> int:
    print("Elite Agentic — Deploy configuration bootstrap")
    print("=" * 50)

    repo = _verify_gh()
    print(f"Target repository: {repo}\n")

    print("--- Vercel secrets ---")
    vercel_token = _prompt_secret("VERCEL_TOKEN")
    vercel_org_id = _prompt_required("VERCEL_ORG_ID")
    vercel_project_id_backend = _prompt_required("VERCEL_PROJECT_ID_BACKEND (production backend)")
    vercel_project_id_backend_staging = _prompt_required(
        "VERCEL_PROJECT_ID_BACKEND_STAGING"
    )
    vercel_project_id_frontend = _prompt_required(
        "VERCEL_PROJECT_ID_FRONTEND (production frontend)"
    )
    vercel_project_id_frontend_staging = _prompt_required(
        "VERCEL_PROJECT_ID_FRONTEND_STAGING"
    )

    print("\n--- Database secrets ---")
    staging_database_url = _prompt_secret("STAGING_DATABASE_URL")
    production_database_url = _prompt_secret("PRODUCTION_DATABASE_URL")

    print("\n--- Application secrets (press Enter to auto-generate) ---")
    ci_secret_key = _prompt_optional("CI_SECRET_KEY") or _generate_key()
    staging_secret_key = _prompt_optional("STAGING_SECRET_KEY") or _generate_key()
    production_secret_key = _prompt_optional("PRODUCTION_SECRET_KEY") or _generate_key()

    print("\n--- Optional secrets ---")
    dora_pushgateway_username = _prompt_optional("DORA_PUSHGATEWAY_USERNAME")
    dora_pushgateway_password = _prompt_optional("DORA_PUSHGATEWAY_PASSWORD")

    print("\n--- Public variables (used by workflows) ---")
    staging_api_url = _prompt_required("STAGING_API_URL (e.g. https://staging-api.example.com/api/v1)")
    production_api_url = _prompt_required("PRODUCTION_API_URL (e.g. https://api.example.com/api/v1)")
    staging_backend_url = _prompt_required("STAGING_BACKEND_URL")
    staging_frontend_url = _prompt_required("STAGING_FRONTEND_URL")
    production_backend_url = _prompt_required("PRODUCTION_BACKEND_URL")
    production_frontend_url = _prompt_required("PRODUCTION_FRONTEND_URL")

    print("\n--- Optional variables ---")
    prometheus_url = _prompt_optional("PROMETHEUS_URL")
    dora_pushgateway_url = _prompt_optional("DORA_PUSHGATEWAY_URL")
    load_test_base_url = _prompt_optional("LOAD_TEST_BASE_URL")

    print("\nWriting secrets to GitHub...")
    secrets_to_set = [
        ("CI_SECRET_KEY", ci_secret_key),
        ("VERCEL_TOKEN", vercel_token),
        ("VERCEL_ORG_ID", vercel_org_id),
        ("VERCEL_PROJECT_ID_BACKEND", vercel_project_id_backend),
        ("VERCEL_PROJECT_ID_BACKEND_STAGING", vercel_project_id_backend_staging),
        ("VERCEL_PROJECT_ID_FRONTEND", vercel_project_id_frontend),
        ("VERCEL_PROJECT_ID_FRONTEND_STAGING", vercel_project_id_frontend_staging),
        ("STAGING_DATABASE_URL", staging_database_url),
        ("PRODUCTION_DATABASE_URL", production_database_url),
    ]
    for name, value in secrets_to_set:
        _set_secret(name, value)

    # Per-environment application secrets in Vercel are recommended, but the
    # workflows in this scaffold read from repository-level secrets. Keep the
    # generated keys here for reference; they must still be pasted into Vercel.
    print("\n  NOTE: STAGING_SECRET_KEY and PRODUCTION_SECRET_KEY must be set in")
    print("  the Vercel project settings (not GitHub Actions). Generated values:")
    print(f"    STAGING_SECRET_KEY={staging_secret_key}")
    print(f"    PRODUCTION_SECRET_KEY={production_secret_key}")

    if dora_pushgateway_username and dora_pushgateway_password:
        _set_secret("DORA_PUSHGATEWAY_USERNAME", dora_pushgateway_username)
        _set_secret("DORA_PUSHGATEWAY_PASSWORD", dora_pushgateway_password)

    print("\nWriting variables to GitHub...")
    variables = [
        ("STAGING_API_URL", staging_api_url),
        ("PRODUCTION_API_URL", production_api_url),
        ("STAGING_BACKEND_URL", staging_backend_url),
        ("STAGING_FRONTEND_URL", staging_frontend_url),
        ("PRODUCTION_BACKEND_URL", production_backend_url),
        ("PRODUCTION_FRONTEND_URL", production_frontend_url),
    ]
    for name, value in variables:
        _set_variable(name, value)

    optional_variables = [
        ("PROMETHEUS_URL", prometheus_url),
        ("DORA_PUSHGATEWAY_URL", dora_pushgateway_url),
        ("LOAD_TEST_BASE_URL", load_test_base_url),
    ]
    for name, value in optional_variables:
        if value:
            _set_variable(name, value)

    print("\n" + "=" * 50)
    print("GitHub configuration complete.")
    print("\nNext manual steps:")
    print("1. Create GitHub environments 'staging' and 'production' under")
    print("   Settings → Environments, with required reviewers and wait timers.")
    print("2. In each Vercel project, set DATABASE_URL, SECRET_KEY, ENV,")
    print("   ALLOWED_ORIGINS, and Clerk OIDC credentials if applicable.")
    print("3. Push to main and verify CI → Security → Contract Tests → Deploy.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
