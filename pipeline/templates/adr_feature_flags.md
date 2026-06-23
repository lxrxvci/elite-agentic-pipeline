# ADR {{number}}: Feature Flag Provider

## Status

- Proposed

## Context

We need to decouple deployment from release so the squad can ship code to production without exposing incomplete features. The initial scaffold used a comma-separated `ENABLED_FEATURES` environment variable, which works for local development but does not support runtime toggles, progressive rollouts, or kill switches.

## Decision

Adopt **Unleash** as the feature flag provider with an environment-variable fallback.

| Layer | Choice |
|---|---|
| Backend SDK | `UnleashClient` (Python) |
| Frontend SDK | `unleash-proxy-client` + React provider |
| Hosting | Self-hosted Unleash Server via Docker Compose locally; managed Unleash Cloud or self-hosted in production |
| Fallback | `ENABLED_FEATURES` / `NEXT_PUBLIC_ENABLED_FEATURES` env variables |

## Consequences

### Positive

- Runtime control of feature flags without redeployment.
- Supports progressive rollouts, user segments, and kill switches.
- Open-source with managed option, aligning with "boring technology."
- Graceful fallback to env variables keeps local development simple.

### Negative

- Adds operational complexity: another service to run and monitor.
- Requires network connectivity from backend/frontend to Unleash.
- Fallback behavior must be tested to avoid surprises if Unleash is unreachable.

## Flag naming convention

- Use dot-separated namespaces: `time-capture.quick-entry`, `invoicing.automated-reminders`.
- Keep flag keys stable; changing a key is equivalent to deleting and recreating the flag.
- Document every flag in `docs/TEST_STRATEGY.md` or a dedicated flag registry.

## Related

- `docs/TEST_STRATEGY.md`
- `src/app/features.py`
- `src/shared/lib/FeatureFlagsProvider.tsx`
