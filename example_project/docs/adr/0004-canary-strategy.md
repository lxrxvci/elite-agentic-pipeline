# ADR 0004: Canary / Progressive Delivery Strategy

## Status

Accepted

## Context

The pipeline deploys a Python serverless backend and a Next.js frontend to Vercel. Vercel promotions are all-at-nothing by default: once `vercel --prod` succeeds, 100% of production traffic is cut over. We need a release safety strategy that detects bad deployments before they impact all users, without requiring a separate Kubernetes cluster or service mesh.

## Decision

We will use a **Vercel-native staged pipeline with synthetic canary, SLO gates, and automatic rollback** as our current progressive-delivery mechanism.

1. **Staging deploy** — every production-bound change is deployed to the staging Vercel projects first.
2. **Staging smoke tests** — verify `/api/v1/health` and the frontend landing page.
3. **Production deploy** — deploy backend and frontend to the production Vercel projects.
4. **Synthetic canary analysis** — immediately after production deploy, run `scripts/canary_analysis.py` against the production backend `/api/v1/health` endpoint and fail if error rate or P99 latency exceed thresholds.
5. **SLO gate** — if `PROMETHEUS_URL` is configured, query production Prometheus with `scripts/slo_check.py` for HTTP 5xx rate and P99 latency over a 5-minute window.
6. **Smoke test** — verify production health endpoints.
7. **Automatic rollback** — if canary analysis, SLO check, or smoke test fails, `vercel rollback` is invoked for both backend and frontend production projects.

This gives us staged, gated, auto-rollback releases. It is not true traffic splitting, but it is the pragmatic limit of the Vercel serverless platform without a separate edge-router or feature-flag service.

## Future options for real traffic splitting

When the product requires percentage-based canaries, we will evaluate one of:

- **Vercel Edge Config + Middleware**: route a configurable percentage of requests to a canary deployment URL or feature branch.
- **Separate canary Vercel projects**: deploy to `backend-canary` / `frontend-canary` projects, point a subdomain (`canary.example.com`) at them, and shift DNS/Edge Config weights.
- **Feature-flag rollout**: use a managed flag service (Unleash, LaunchDarkly, PostHog) to gate new backend behavior and new frontend UI for a subset of users.
- **Move to container/Kubernetes platform**: adopt Flagger or Argo Rollouts if we outgrow Vercel serverless.

## Consequences

- **Pros**: Fully automated, no extra infrastructure, uses Vercel CLI rollback, low mean time to detect (MTTD) and recover (MTTR).
- **Cons**: Bad changes still hit 100% of production traffic before detection. Business-level metrics (invoice creation rate, login success) are not yet evaluated during canary.

## Related

- `.github/workflows/deploy.yml`
- `scripts/canary_analysis.py`
- `scripts/slo_check.py`
- `docs/RUNBOOKS/rollback.md`
