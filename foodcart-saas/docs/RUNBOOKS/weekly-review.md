# Runbook: Weekly SLO / Error-Budget Review

## Purpose

Review the health of Foodcart SaaS once per week, confirm SLO attainment,
error-budget burn, and identify reliability risks before they become incidents.
This runbook is used by the on-call SRE during shift handoff and by the squad
lead in the weekly Observe & Improve sync.

## When

- Every Monday at 09:30 (on-call handoff).
- Within 24 hours after any SEV1/SEV2 incident.

## Inputs

| Source | Location |
|---|---|
| SLOs & error budgets | `docs/SLOs.md` |
| Metrics dashboard | Grafana `/d/foodcart-api` |
| Product metrics | `METRICS.md` |
| Incident log | `docs/post-mortems/` |
| Deployment log | GitHub Actions `deploy.yml` runs |
| Alert history | PagerDuty / Slack `#incidents` |

## Review checklist

### 1. Availability & error budget

- [ ] Pull the 30-day availability ratio from Prometheus or access logs.
- [ ] Compare against the 99.9% SLO.
- [ ] Calculate remaining error budget for the month.
- [ ] If budget is ≥ 50% burned, page on-call and alert the squad channel.
- [ ] If budget is 100% burned, declare a feature freeze until SLO is restored
      or the budget resets.

### 2. Latency

- [ ] Pull p50, p95, and p99 API latency for the last 7 days.
- [ ] Confirm p95 is under the 300 ms SLO.
- [ ] Identify any endpoints with p95 > 500 ms.
- [ ] Review AI assistant end-to-end latency (p95 target < 5 s).

### 3. Error rate

- [ ] Pull 5xx rate over the last 7 days.
- [ ] Confirm it is under the 0.1% SLO.
- [ ] Group 5xx by endpoint, tenant, and exception type.
- [ ] Open tickets for any new error classes.

### 4. Traffic & saturation

- [ ] Review RPS trends for public sites and the admin dashboard.
- [ ] Check PostgreSQL connection-pool utilization.
- [ ] Check CPU, memory, and disk saturation on backend and database.
- [ ] Flag any resource > 80% p95 utilization.

### 5. Frontend performance

- [ ] Review LCP, INP, and CLS from Vercel Analytics / Chrome UX Report.
- [ ] Confirm LCP p75 < 2.5 s.
- [ ] Review Core Web Vitals by template and tenant slug.

### 6. AI assistant guardrails

- [ ] Count guardrail blocks and audit events.
- [ ] Review any new allowlist/denylist patterns.
- [ ] Confirm no bypasses or cross-tenant access was detected.

### 7. Deployments & changes

- [ ] List production deploys in the last 7 days.
- [ ] Note any failed or rolled-back deploys.
- [ ] Confirm open post-mortem action items are tracked.
- [ ] Review active feature flags and stale flags needing cleanup.

### 8. Incidents & post-mortems

- [ ] Review all SEV1/SEV2 incidents from the week.
- [ ] Confirm post-mortems are scheduled or completed within 48 hours.
- [ ] Verify action items have owners and due dates.
- [ ] Check for recurring themes (e.g., same dependency, same tenant pattern).

### 9. Kaizen / friction log

- [ ] Review `docs/KAIZEN.md` for new friction entries.
- [ ] Pick 1–2 improvements for the next sprint.
- [ ] Update backlog with improvement experiments.

## Outputs

1. Update `METRICS.md` with the latest weekly numbers.
2. Update the `Review Log` table in `docs/SLOs.md`.
3. Record decisions and follow-ups in the weekly meeting notes.
4. If reliability work is needed, create backlog items and tag them
   `reliability` / `error-budget`.

## Review log template

| Date | Reviewer | Availability | p95 latency | 5xx rate | Budget remaining | Actions |
|---|---|---|---|---|---|---|
| YYYY-MM-DD | Name | 99.9x% | xxx ms | 0.0x% | xx% | |
