# ADR 0006: Feature Flag Strategy

## Status

Accepted

## Context

The product needs a way to ship features gradually, run experiments, and disable risky changes without redeploying. We want a solution that works in local development, CI, staging, and production without forcing every team to run a self-hosted Unleash instance.

## Decision

We support a three-tier feature flag resolution order:

1. **Managed feature-flag endpoint** (`MANAGED_FEATURE_FLAGS_URL`) — a generic HTTP endpoint that returns a JSON map of flag keys to booleans. This lets teams use any managed provider (Unleash Cloud, LaunchDarkly edge proxy, PostHog, a custom service) without changing application code.
2. **Unleash** (`UNLEASH_URL`) — when a managed endpoint is not configured, the backend uses the Unleash client if `UNLEASH_URL` is set.
3. **Environment fallback** (`ENABLED_FEATURES`) — a comma-separated list of enabled flag keys used for local development and CI when no service is configured.

The frontend already reads `NEXT_PUBLIC_ENABLED_FEATURES` and can be extended to call the same managed endpoint or provider SDK as needed.

## Consequences

- **Pros**: Provider-agnostic, zero lock-in, works locally without external accounts, easy to adopt a managed service later.
- **Cons**: The managed endpoint path is simple (boolean flags only) and does not support user-targeting rules out of the box. Advanced targeting should use a full provider SDK.

## Configuration

Backend environment variables:
- `MANAGED_FEATURE_FLAGS_URL` — optional JSON endpoint.
- `MANAGED_FEATURE_FLAGS_TOKEN` — optional bearer token for the endpoint.
- `UNLEASH_URL`, `UNLEASH_API_TOKEN`, `UNLEASH_APP_NAME` — optional Unleash config.
- `ENABLED_FEATURES` — fallback comma-separated flag list.

## Related

- `src/backend/src/app/features.py`
- `src/backend/src/app/config.py`
- `src/frontend/src/shared/lib/features.ts`
