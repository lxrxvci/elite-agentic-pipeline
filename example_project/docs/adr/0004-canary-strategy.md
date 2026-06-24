# ADR 0004: Canary / Progressive Delivery Strategy

## Status

Accepted

## Context

The pipeline deploys a Python serverless backend and a Next.js frontend to Vercel. Vercel promotions are all-or-nothing by default: once `vercel --prod` succeeds, 100% of production traffic is cut over. We need a release safety strategy that detects bad deployments before they impact all users, without requiring a separate Kubernetes cluster or service mesh.

## Decision

We will use **Vercel Edge Config + Middleware for percentage-based canary traffic splitting**, combined with preview-deployment promotion and automatic rollback.

1. **Staging deploy** — every production-bound change is deployed to the staging Vercel projects first.
2. **Staging smoke tests** — verify `/api/v1/health` and the frontend landing page.
3. **DAST** — run OWASP ZAP against staging before any production promotion.
4. **Production migrations** — run Alembic migrations against the production database.
5. **Backend preview deploy** — deploy the backend to the production Vercel project as a **preview** (not promoted to production yet).
6. **Frontend preview deploy** — deploy the production frontend build as a **preview** (not promoted to production yet).
7. **Canary traffic split** — write the preview URLs into Vercel Edge Config (`canary.deploymentUrl` for the frontend and `canary.apiUrl` for the backend) with a small percentage (default 10%). The frontend edge middleware reads this config, rewrites the canary bucket to the frontend preview, and sets an `elite-canary-api-url` cookie so the browser API client routes requests to the backend canary preview. The response CSP is patched to allow the backend canary origin in `connect-src`.
8. **Synthetic canary analysis** — run `scripts/canary_analysis.py` against both the stable production backend URL and the backend canary preview URL, failing if either breaches error-rate or P99-latency thresholds.
9. **SLO gate** — if `PROMETHEUS_URL` is configured, query production Prometheus with `scripts/slo_check.py` for HTTP 5xx rate and P99 latency over a 5-minute window.
10. **Promote backend preview to production** — only after canary + SLO gates pass, run `vercel promote <backend-preview-url>` to make the backend preview the new production deployment, then clear `canary.apiUrl` from Edge Config.
11. **Promote frontend preview to production** — run `vercel promote <frontend-preview-url>` to make the frontend preview the new production deployment, then set Edge Config `canary.percentage = 100`.
12. **Smoke test** — verify the promoted production health endpoints.
13. **Automatic rollback** — if canary analysis, SLO check, promotion, or smoke test fails, set `canary.percentage = 0` (which also clears `canary.apiUrl`) and invoke `vercel rollback` for both backend and frontend production projects.

This gives us staged, gated, **true percentage-based canaries** with automatic rollback, implemented entirely on the Vercel platform.

## Future options

When the product outgrows this setup, we will evaluate:

- **Separate canary Vercel projects**: deploy to `backend-canary` / `frontend-canary` projects and shift DNS/Edge Config weights.
- **Feature-flag rollout**: use a managed flag service (Unleash, LaunchDarkly, PostHog) to gate new backend behavior and new frontend UI for a subset of users.
- **Move to container/Kubernetes platform**: adopt Flagger or Argo Rollouts if we need more advanced canary strategies.

## Consequences

- **Pros**: True percentage-based traffic splitting; bad deployments only impact the canary percentage; fully automated; no extra infrastructure beyond Edge Config; low mean time to detect (MTTD) and recover (MTTR).
- **Cons**: Backend canary relies on the frontend edge middleware to route API traffic via a cookie, so non-browser API clients still hit the stable backend; business-level metrics (invoice creation rate, login success) require Prometheus to be wired in production.

## Related

- `.github/workflows/deploy.yml`
- `src/frontend/src/middleware.ts`
- `src/frontend/src/shared/api/client.ts`
- `src/frontend/src/shared/lib/canary.ts`
- `scripts/set_canary.py`
- `scripts/canary_analysis.py`
- `scripts/slo_check.py`
- `docs/RUNBOOKS/rollback.md`
