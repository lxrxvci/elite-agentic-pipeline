# SRE Playbook — Foodcart SaaS

## Overview

This playbook defines the operational contract between the SRE Platform team and
the Foodcart SaaS squad. It covers alert-to-runbook mapping, escalation,
on-call rotation, and error-budget policy.

| Attribute | Value |
|---|---|
| Product | Foodcart SaaS |
| Version | 0.1.0 (Cycle 1) |
| Author | SRE Platform |
| Date | 2026-06-24 |
| Review cadence | Monthly |

## Alert-to-Runbook Mapping

Every production alert must link to a runbook. The table below maps the SRE
Platform alert catalog to Foodcart-specific runbooks.

| Alert | Severity | Runbook | Threshold | SLO |
|---|---|---|---|---|
| `FoodcartAvailabilityBelowSLO` | critical | `docs/RUNBOOKS/incident-response.md` | 99.9% over 5 min | 99.9% monthly |
| `FoodcartErrorRateCritical` | critical | `docs/RUNBOOKS/incident-response.md` | 5xx > 0.5% over 5 min | < 0.1% monthly |
| `FoodcartErrorRateHigh` | warning | `docs/RUNBOOKS/incident-response.md` | 5xx > 0.1% over 5 min | < 0.1% monthly |
| `FoodcartLatencyP95Critical` | critical | `docs/RUNBOOKS/incident-response.md` | p95 > 500ms over 5 min | p95 < 300ms monthly |
| `FoodcartLatencyP95High` | warning | `docs/RUNBOOKS/incident-response.md` | p95 > 300ms over 5 min | p95 < 300ms monthly |
| `FoodcartAIAssistantLatencyHigh` | warning | `docs/RUNBOOKS/incident-response.md` | p95 > 5s over 5 min | p95 < 5s monthly |
| `FoodcartAIAssistantGuardrailTriggered` | critical | `docs/RUNBOOKS/incident-response.md` | Any guardrail block/audit-fail | Zero tolerance |
| `FoodcartFrontendLCPHigh` | warning | `docs/RUNBOOKS/incident-response.md` | LCP p75 > 2.5s over 10 min | LCP < 2.5s for 75% users |
| `FoodcartDatabasePoolCritical` | critical | `docs/RUNBOOKS/incident-response.md` | Pool > 85% over 5 min | < 80% monthly |
| `FoodcartDatabasePoolSaturation` | warning | `docs/RUNBOOKS/incident-response.md` | Pool > 80% over 5 min | < 80% monthly |
| `FoodcartTrafficDrop` | warning | `docs/RUNBOOKS/incident-response.md` | RPS < 70% baseline over 5 min | Monitoring signal |
| `FoodcartErrorBudgetBurn50` | critical | `docs/RUNBOOKS/incident-response.md` | 50% monthly budget burned | 0.1% availability budget |
| `FoodcartErrorBudgetExhausted` | critical | `docs/RUNBOOKS/incident-response.md` | 100% monthly budget burned | 0.1% availability budget |
| `FoodcartPublicSiteDown` | critical | `docs/RUNBOOKS/incident-response.md` | Probe fails for 2 min | 99.9% availability |

### Alert annotations contract

All Prometheus rules in `pipeline/platform/sre/prometheus/recording-alerting-rules.yml`
include:

- `summary` — one-line description.
- `description` — human-readable detail with current value.
- `runbook_url` — link to this playbook or a specific runbook.
- `dashboard_url` — link to the Grafana Golden Signals dashboard.

## On-Call Rotation

### Rotation pattern

- **Primary:** 7-day shift, Monday 09:00 → Monday 09:00 (local time).
- **Secondary:** shadows primary; receives pages only if primary does not
  acknowledge within 5 minutes.
- **Follow-the-sun:** optional split shifts once the team has coverage in ≥2
  time zones.

### Participants

| Role | Responsibility |
|---|---|
| Primary on-call SRE | Triage, mitigate, communicate, escalate. |
| Secondary on-call SRE | Backup; handles if primary is unreachable. |
| Tech Lead | Escalation point for architecture or risky changes. |
| Product Owner | Customer/status communication for SEV1/SEV2. |
| AppSec Engineer | AI guardrail bypass, tenant isolation, or data breach. |

### Handoff checklist

1. Review open incidents and error-budget status.
2. Note any in-progress deploys, feature-flag experiments, or game days.
3. Confirm access to PagerDuty, Grafana, Loki/Tempo, GitHub Actions, Vercel, Fly.
4. Document handoff in the on-call log.

## Escalation Policy

| Severity | Criteria | Response Time | Channel | Escalation Path |
|---|---|---|---|---|
| SEV1 | Complete outage, data loss, security breach, AI guardrail bypass, confirmed tenant isolation failure | 15 min | #war-room + PagerDuty | Primary → Secondary (5 min) → Tech Lead (10 min) → Product + Engineering VP |
| SEV2 | Major feature degraded (>25% error budget or customer impact) | 1 hour | #incidents + PagerDuty | Primary → Tech Lead → Product Owner |
| SEV3 | Minor degradation, workaround available | 4 hours | #incidents | Primary files ticket; escalate if trending SEV2 |
| SEV4 | Cosmetic / low impact | Best effort | Backlog | No escalation |

### Special escalation paths

- **AI assistant guardrail bypass:** Page AppSec immediately; disable the
  `ai-assistant` feature flag; preserve audit logs.
- **Tenant isolation failure:** Treat as SEV1; page AppSec and Tech Lead;
  revoke affected sessions.
- **Error-budget 50% burn:** Page on-call and prioritize reliability work over
  feature work.
- **Error-budget 100% burn:** Feature freeze until budget resets or SLO is
  restored; Tech Lead + Product Owner decide exceptions.

## Error-Budget Policy

### Budget period

30 days, resetting on the 1st of each month.

### Budget math

| SLO | Budget |
|---|---|
| Availability 99.9% | 0.1% of requests may fail (≈ 43 minutes downtime/month). |
| Latency p95 < 300ms | 0.1% of 5-minute windows may exceed 300ms. |
| Error rate < 0.1% | 0.1% of responses may be 5xx. |
| Frontend LCP < 2.5s | 5% of users may experience LCP > 2.5s. |

### Burn-rate gates

| Burn | Action |
|---|---|
| 25% in single deploy | Auto-rollback or manual rollback required. |
| 50% | Page on-call; pause non-critical feature releases. |
| 100% | Feature freeze until SLO is restored or budget resets. |

### Exceptions

The following do **not** consume error budget:

- Security incidents and forced remediation.
- Force-majeure events (cloud provider outages, DDoS beyond our control).
- Scheduled maintenance windows published ≥48 hours in advance.

### Review cadence

- Weekly: on-call reviews error-budget burn during shift handoff.
- Monthly: SRE Platform reviews attainment in SLO review meeting.
- Per incident: any SEV1/SEV2 incident recalculates budget impact.

## Operational Toil Budget

- Cap operational toil at 50% of SRE time.
- Toil above the cap must be reduced via automation, self-healing, or
  elimination within the next sprint.
- On-call engineers log toil sources quarterly for review.

## Weekly Review

The weekly review closes the feedback loop between production behavior and
engineering action. It is run by the on-call SRE or DevOps/SRE lead using the
checklist in `pipeline/platform/sre/weekly-review-checklist.md`.

### Agenda

1. **Four golden signals** — latency, traffic, errors, saturation.
2. **SLOs and error budget** — remaining budget, burn-rate alerts, freeze status.
3. **Product metrics** — WASE, activation, engagement, AI assistant usage, Core
   Web Vitals.
4. **DORA and flow metrics** — deployment frequency, lead time, change failure
   rate, recovery time, WIP, cycle time.
5. **Incident and alert review** — SEV1/SEV2 follow-up, post-mortem action items,
   noisy alerts.
6. **Friction logging / Kaizen** — engineer-reported friction, improvement
   candidates.
7. **Improvement backlog** — convert findings into prioritized experiments.
8. **Communication** — update `METRICS.md`, share decisions, assign owners.

### Outputs

- Updated `METRICS.md` with current values and signals.
- Filed friction logs and Kaizen experiments.
- Tuned alerts (see `pipeline/platform/sre/alert-tuning-guide.md`).
- Closed or reassigned post-mortem action items.

## Kaizen

Kaizen captures small, continuous improvements identified during operations,
on-call, and weekly reviews. It is the SRE Platform complement to the product
backlog.

### Friction logging

Any engineer may log a friction point by opening an issue tagged `friction-log`
and linking it from the weekly review. Good friction logs include:

- The task or alert that was painful.
- Time lost or risk introduced.
- A proposed fix or experiment.

### Improvement experiments

| ID | Experiment | Hypothesis | Success criteria | Owner | Status |
|---|---|---|---|---|---|
| KAI-1 | Reduce AI assistant p99 latency | Caching common menu edits will cut proposal latency by 30% | p99 < 3s for top 5 prompts | Backend | Planned |
| KAI-2 | Lower public-site LCP | Switching TemplateSelector to next/image will improve LCP | LCP p75 < 2.5s | Frontend | Planned |
| KAI-3 | Auto-resolve stale alerts | Adding `for: 5m` to transient alerts will reduce pager noise | <1 false-positive page/week | SRE | Planned |

### Blitz weeks

- Run a reliability/observability blitz week once per quarter.
- Focus on the highest-voted friction logs and any SLO-risk items.
- Outputs: runbook updates, automation, alert tuning, dashboard improvements,
  and post-mortem action items.

### Review cadence

- **Weekly:** review new friction logs and experiment progress in squad review.
- **Monthly:** SRE Platform reviews Kaizen backlog for platform-wide patterns.
- **Quarterly:** blitz-week planning and metric-driven prioritization.

## Useful Links

- SLOs: `docs/SLOs.md`
- Incident response: `docs/RUNBOOKS/incident-response.md`
- Rollback: `docs/RUNBOOKS/rollback.md`
- On-call: `docs/RUNBOOKS/oncall.md`
- Chaos engineering: `docs/CHAOS_ENGINEERING.md`
- Post-mortem template: `docs/POST_MORTEM_TEMPLATE.md`
- SRE Platform templates: `pipeline/platform/sre/`
- Grafana dashboard: `https://grafana.internal/d/foodcart-api`
