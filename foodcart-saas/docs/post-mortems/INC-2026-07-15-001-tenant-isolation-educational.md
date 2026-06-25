# Post-Mortem: Hypothetical Tenant Isolation Incident — Educational Exercise

> **This is an educational, hypothetical post-mortem.** No real incident
> occurred. It was authored by the SRE Platform team to train the incident
> commander, response workflow, and blameless post-mortem process for a
> tenant-isolation failure scenario.

## Metadata

| Field | Value |
|---|---|
| Incident title | Hypothetical cross-tenant menu read on public site |
| Incident ID | INC-2026-07-15-001-EDU |
| Date / time (UTC) | 2026-07-15 14:23–14:51 UTC (28 minutes) |
| Severity | SEV1 (simulated) |
| Affected service(s) | Public site rendering, menu repository |
| Affected tenant(s) / sites | `banhmi-fusion-demo.foodcartsite.com` (simulated viewer) |
| Incident commander | Alex DevOps (simulated) |
| Post-mortem author | SRE Platform |
| Reviewers | Tech Lead, AppSec Engineer, On-call SRE |
| Status | Closed (educational) |

## Executive Summary

During a simulated deployment, a repository-layer filter bug caused the public
site endpoint for one tenant to return a menu item belonging to another tenant.
The failure was detected by a synthetic probe and an error-rate alert within 90
seconds. The response team disabled public-site rendering for the affected slug,
revoked active sessions, reverted the change, and verified that PostgreSQL RLS
blocked the cross-tenant read at the database layer. No real customer data was
exposed.

## Impact

### Customer impact

- Number of affected tenants / public sites: 1 simulated tenant, 1 public site.
- Number of failed requests / degraded requests: ~12 simulated requests returned
  HTTP 500 after RLS blocked the cross-tenant read.
- Data integrity / privacy impact: No real PII exposed; the injected test case
  was a single synthetic menu item.
- Error-budget consumed: 0% (staging-only educational exercise).

### Business impact

- Estimated revenue or signup impact: None (hypothetical).
- Support ticket volume: 0.
- Status-page communication required? No.

## Timeline

| Time (UTC) | Event | Source |
|---|---|---|
| 14:23:00 | Injected repository filter bug deployed to staging | Game-day injector |
| 14:24:30 | Synthetic probe for `banhmi-fusion-demo.foodcartsite.com` fails | Blackbox exporter |
| 14:24:45 | `FoodcartErrorRateHigh` alert fires in #incidents | Alertmanager |
| 14:25:00 | On-call SRE acknowledges page | PagerDuty |
| 14:27:00 | Incident declared SEV1, #war-room opened | Slack #war-room |
| 14:29:00 | AppSec and Tech Lead paged and joined | PagerDuty |
| 14:31:00 | Public-site rendering feature flag disabled for affected slug | Feature-flag UI |
| 14:33:00 | Active sessions for affected tenant revoked | Clerk dashboard |
| 14:36:00 | Injected bug reverted via rollback pipeline | GitHub Actions |
| 14:42:00 | Smoke tests pass; RLS confirmed active in PostgreSQL logs | Loki + psql |
| 14:51:00 | Incident resolved, war-room closed | Slack update |

## Root Cause

### What happened

A code change in the menu repository introduced a conditional branch that used
`site_id` from an untrusted query parameter instead of the validated tenant
context when fetching menu items. The repository function normally relies on a
higher-layer service to enforce the tenant filter, but the new branch bypassed
that check for a performance optimization.

### Why it happened

- The optimization branch did not route through the existing tenant-scoped query
  builder.
- Unit tests covered the happy path but did not include a test for a mismatched
  `site_id` parameter.
- Code review focused on the performance improvement and missed the tenant-scope
  regression.
- RLS was enabled but not enforced in the application code path used by the new
  branch (the query used a raw SQL fragment).

### Five Whys

1. Why did the public site show another tenant's menu item? → The repository
   returned data for a `site_id` that did not belong to the requesting tenant.
2. Why did the repository return the wrong `site_id`? → A new branch used the
   query parameter directly instead of the validated tenant context.
3. Why was the branch able to bypass tenant validation? → The code path used a
   raw SQL fragment and was not covered by the tenant-scoped query builder.
4. Why did this reach staging? → The unit tests did not assert cross-tenant
   rejection for the new branch.
5. Why was the test missing? → The team did not have a mandatory checklist item
   for tenant-isolation coverage on repository changes.

## Detection & Response

### How did we detect it?

- Alert name(s): `FoodcartErrorRateHigh`, synthetic probe failure.
- Support channel: None (synthetic detection).
- Manual observation: Game-day observer noted the alert.
- Detection gap: We relied on a 500 error from RLS; a silent cross-tenant read
  that returned 200 would not have triggered the error-rate alert. A dedicated
  tenant-isolation synthetic check is needed.

### Response effectiveness

- Was the runbook accurate and accessible? Yes.
- Did escalation happen within target time? Yes (SEV1 target: 15 minutes).
- Were feature-flag kill switches effective? Yes; public-site rendering was
  disabled for the affected slug in ~2 minutes.
- What slowed response? Revoking sessions required manual steps in the Clerk
  dashboard; this should be scripted.

## Lessons Learned

### What went well

- RLS at the PostgreSQL layer blocked the actual data leak and forced a 500
  response.
- Synthetic probes detected the failure quickly.
- Feature-flag kill switch worked as intended.
- Escalation to AppSec and Tech Lead happened within SEV1 targets.

### What went poorly

- The response relied on manual session revocation.
- No dedicated tenant-isolation alert existed; detection was incidental to the
  error-rate alert.
- The repository change lacked a negative test for cross-tenant access.

### Where we got lucky

- RLS was already enabled and caught the attempt at the database layer.
- The bug was injected in staging as part of a game day, not in production.

## Action Items

| ID | Action | Owner | Due date | Priority | Status |
|---|---|---|---|---|---|
| AI-1 | Add mandatory tenant-isolation review checklist item for repository PRs | Tech Lead | 2026-07-22 | P0 | Open |
| AI-2 | Implement automated session-revocation script for tenant-isolation incidents | DevOps/SRE | 2026-07-29 | P0 | Open |
| AI-3 | Add dedicated `FoodcartTenantIsolationDetected` alert using audit-log signal | SRE Platform | 2026-08-05 | P1 | Open |
| AI-4 | Add negative unit and E2E tests for cross-tenant menu read | Backend Lead | 2026-08-05 | P1 | Open |
| AI-5 | Update `docs/RUNBOOKS/incident-response.md` with tenant-isolation play | DevOps/SRE | 2026-07-29 | P1 | Open |

## Appendix

### Relevant links

- Incident Slack thread: `#war-room` (simulated)
- PagerDuty incident: PD-EDU-2026-07-15-001
- Grafana dashboard snapshot: `https://grafana.internal/d/foodcart-api/snapshot/edu-001`
- Trace / log queries: `tenant_slug="banhmi-fusion-demo"`, `error="tenant isolation blocked by RLS"`
- Deployment that preceded incident: Simulated game-day injection
- Feature-flag state at time of incident: `public-site-rendering` enabled globally

### Data & logs

```text
2026-07-15T14:24:32Z ERROR menu.repository cross-tenant read blocked by RLS
  site_id_requested=550e8400-e29b-41d4-a716-446655440002
  site_id_allowed=550e8400-e29b-41d4-a716-446655440001
  user_id=anon-public-site
  trace_id=abc123def456
```

No PII is present in the logs above.

## Blameless Checklist

- [x] No individual is named as the cause.
- [x] Focus is on system, process, and tooling improvements.
- [x] Action items are specific, owned, and time-bound.
- [x] Reviewed by incident commander and at least one engineer not involved in the response.
- [x] Shared with the team within 48 hours of resolution.
- [x] Follow-up review scheduled to verify action-item completion.

## Approval

| Role | Name | Approval date |
|---|---|---|
| Incident commander | Alex DevOps | 2026-07-16 |
| Tech Lead | (simulated) | 2026-07-16 |
| SRE Platform (for SEV1) | SRE Platform | 2026-07-16 |
