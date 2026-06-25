# Kaizen / Friction Log — Foodcart SaaS

*Operational friction points and improvement experiments for Cycle 1.*

## How to use this file

Engineers log friction they hit while building, deploying, or operating
Foodcart SaaS. Each entry describes the pain, impact, and a proposed
improvement. During the weekly Observe & Improve review the squad picks
1–2 items to pull into the backlog.

## Log

### KZ-001: Prometheus SLO gates are skipped when PROMETHEUS_URL is unset

- **Area:** CI/CD / observability
- **Friction:** The `slo_check.py` script and deploy gates skip metric-based
  validation when `PROMETHEUS_URL` is not configured. This means the canary
  pipeline relies only on health probes and smoke tests, missing real SLO
  signal.
- **Impact:** Medium. The first production deploys will not have SLO-gated
  promotion until Prometheus is wired.
- **Proposed improvement:**
  1. Make `PROMETHEUS_URL` a required production environment variable in
     `docs/DEPLOYMENT.md`.
  2. Add a CI check that fails the deploy gate if `PROMETHEUS_URL` is missing
     in production.
  3. Provide a Terraform output or environment setup script that exports
     `PROMETHEUS_URL` automatically.
- **Owner:** DevOps / SRE
- **Status:** Open

### KZ-002: Canary analysis is untested against real traffic shapes

- **Area:** Deployment / progressive delivery
- **Friction:** `canary_analysis.py` compares error rate and latency, but it
  has not been validated against the actual request mix of public sites
  (heavy on GET `/api/v1/foodcart/public/...`) vs. admin dashboard.
- **Impact:** Medium. The canary may pass while a tenant-specific path is
  degraded.
- **Proposed improvement:**
  1. Add synthetic load tests in `tests/perf/` that mirror public-site and
     admin-dashboard request mixes.
  2. Record baseline metrics in staging before the first production deploy.
  3. Update `canary_analysis.py` to accept per-path SLO thresholds.
- **Owner:** DevOps / SRE + QA Enablement
- **Status:** Open

### KZ-003: Rollback runbook assumes Vercel CLI access

- **Area:** Incident response
- **Friction:** The manual rollback steps in `docs/RUNBOOKS/release-rollback.md`
  require a locally authenticated Vercel CLI. An on-call engineer may not have
  this ready during an incident.
- **Impact:** Medium. Slower recovery time if automated rollback fails.
- **Proposed improvement:**
  1. Add a `scripts/rollback.py` wrapper that uses the Vercel API and reads
     secrets from the environment.
  2. Document a GitHub Actions workflow dispatch path for manual rollback.
  3. Add a pre-flight checklist to the on-call runbook confirming CLI access.
- **Owner:** DevOps / SRE
- **Status:** Open

### KZ-004: AI assistant latency lacks per-operation breakdown

- **Area:** Observability / AI assistant
- **Friction:** The AI assistant SLO measures end-to-end latency for a
  structured change proposal, but it does not break down LLM call time vs.
  schema validation vs. guardrail checks. This makes it hard to tune the
  guardrails or choose a faster model.
- **Impact:** Low–Medium. Hidden latency hotspots once AI usage grows.
- **Proposed improvement:**
  1. Add OpenTelemetry spans for `guardrail`, `llm_call`, `schema_validate`,
     and `revision_apply` inside `src/app/routers/foodcart/ai.py`.
  2. Add per-operation latency metrics and alerts.
  3. Dashboard the p95 of each stage in Grafana.
- **Owner:** Backend Engineer + DevOps / SRE
- **Status:** Open

### KZ-005: Feature-flag cleanup is manual

- **Area:** Deployment / feature flags
- **Friction:** The policy says remove flags within 30 days of full rollout,
  but there is no automated reminder or stale-flag report.
- **Impact:** Low. Risk of flag debt accumulating.
- **Proposed improvement:**
  1. Add a weekly CI job that lists flags older than 30 days at 100%.
  2. Open a GitHub issue automatically for each stale flag.
  3. Add a dashboard panel showing active flag count.
- **Owner:** DevOps / SRE
- **Status:** Open

### KZ-006: Tenant isolation incidents need faster detection

- **Area:** Security / observability
- **Friction:** If a tenant sees another tenant's data, detection currently
  depends on a user report or a manual audit. There is no automated anomaly
  detection for cross-tenant access.
- **Impact:** High. Tenant isolation is a core promise; delayed detection is a
  reputational risk.
- **Proposed improvement:**
  1. Add a log-based alert that fires when a request's authenticated tenant
     does not match the resource's tenant.
  2. Run periodic chaos tests that attempt cross-tenant access and verify
     the alert fires.
  3. Add an audit dashboard for guardrail and tenant-boundary events.
- **Owner:** AppSec Engineering + DevOps / SRE
- **Status:** Open

### KZ-007: Frontend Core Web Vitals are not collected in local dev

- **Area:** Developer experience / performance
- **Friction:** Engineers cannot easily see LCP/INP/CLS impact of changes
  during local development because web-vitals ingestion is tied to production
  analytics.
- **Impact:** Low. Performance regressions may only surface in production.
- **Proposed improvement:**
  1. Add a local-only web-vitals console reporter in development builds.
  2. Document how to send local vitals to the backend `/api/v1/vitals` endpoint
     for testing.
  3. Add a vitals smoke test to CI.
- **Owner:** Frontend Engineer + DevOps / SRE
- **Status:** Open

### KZ-008: Post-mortem action items are not centrally tracked

- **Area:** Incident learning
- **Friction:** Action items from post-mortems live in markdown files under
  `docs/post-mortems/`. There is no single view of open action items and due
  dates.
- **Impact:** Low–Medium. Action items can stall.
- **Proposed improvement:**
  1. Adopt a standard `action-items` section in every post-mortem.
  2. Create a GitHub Project view or a markdown index that aggregates open
     action items.
  3. Review action-item closure in the weekly SLO review.
- **Owner:** DevOps / SRE
- **Status:** Open

## Improvement backlog

| ID | Experiment | Expected outcome | Sprint |
|---|---|---|---|---|
| KZ-001 | Require `PROMETHEUS_URL` for production deploys | SLO gates always run | Cycle 2 |
| KZ-003 | Add `scripts/rollback.py` and workflow dispatch | < 10 min manual rollback | Cycle 2 |
| KZ-006 | Cross-tenant access detection alert | < 5 min detection | Cycle 2 |
| KZ-004 | AI assistant per-operation tracing | Latency hotspot visibility | Cycle 2 |
| KZ-005 | Weekly stale-flag report | Flag debt under 20 active flags | Cycle 3 |
| KZ-002 | Realistic canary load tests | Canary catches path-level regressions | Cycle 3 |
| KZ-007 | Local web-vitals tooling | Performance feedback in dev | Cycle 3 |
| KZ-008 | Post-mortem action-item index | 100% action items closed on time | Cycle 2 |
