# Service Level Objectives

## Overview

| Attribute | Value |
|---|---|
| Product | Foodcart SaaS |
| Version | 0.1.0 (Cycle 1) |
| Author | DevOps / SRE |
| Date | 2026-06-24 |
| Review cadence | Monthly |

## Scope

Cycle 1 covers the public tenant website, admin dashboard, FastAPI backend,
AI Website Assistant, and ingestion pipelines. SLOs below apply to the
production environment (`foodcartsite.com` and `*.foodcartsite.com`).

## SLIs & SLOs

### API Availability

| Field | Value |
|---|---|
| SLI | Ratio of successful HTTP responses (2xx/3xx) to total requests |
| SLO | 99.9% over 30 days |
| Error budget | 0.1% of requests may fail (≈ 43 minutes of downtime per month) |
| Measurement | OTLP / Prometheus metrics from `/health` and access logs |
| Alert threshold | 99.5% over 5 minutes |

### API Latency

| Field | Value |
|---|---|
| SLI | p95 response time for API requests |
| SLO | p95 < 300ms over 30 days |
| Error budget | p95 may exceed 300ms for no more than 0.1% of 5-minute windows |
| Measurement | OTLP / Prometheus histograms |
| Alert threshold | p95 > 500ms for 5 minutes |

### Frontend Performance

| Field | Value |
|---|---|
| SLI | Largest Contentful Paint (LCP) for authenticated dashboard and public sites |
| SLO | LCP < 2.5s for 75th percentile of users |
| Error budget | LCP > 2.5s for no more than 5% of users over 30 days |
| Measurement | Vercel Analytics / Chrome UX Report / web-vitals |
| Alert threshold | LCP > 4s for 5 minutes |

### Error Rate

| Field | Value |
|---|---|
| SLI | Ratio of 5xx responses to total responses |
| SLO | < 0.1% over 30 days |
| Error budget | 5xx rate may exceed 0.1% for no more than 0.1% of requests |
| Measurement | Access logs / APM |
| Alert threshold | > 0.5% for 5 minutes |

### AI Assistant Latency

| Field | Value |
|---|---|
| SLI | End-to-end latency for a structured change proposal |
| SLO | p95 < 5s over 30 days |
| Measurement | OpenTelemetry traces on `/api/v1/foodcart/ai/...` endpoints |
| Alert threshold | p95 > 10s for 5 minutes |

### Traffic (Golden Signal)

| Field | Value |
|---|---|
| SLI | Requests per second (RPS) across all public and admin endpoints |
| SLO | N/A (monitoring signal, not a target) |
| Measurement | Access logs / Prometheus counters |
| Alert threshold | Anomalous drop > 30% for 5 minutes or spike > 3x baseline |

### Saturation (Golden Signal)

| Field | Value |
|---|---|
| SLI | Database connection pool utilization, CPU, memory, and disk on critical paths |
| SLO | < 80% utilization for p95 over 30 days |
| Measurement | PostgreSQL metrics, Vercel function metrics, container metrics |
| Alert threshold | > 85% for 5 minutes |

## Error Budget Policy

1. **Budget period:** 30 days, reset monthly on the 1st.
2. **Error budget math:**
   - Availability: 0.1% of total requests may fail.
   - Latency: 0.1% of 5-minute windows may have p95 > 300ms.
   - Error rate: 0.1% of total responses may be 5xx.
3. **Exhaustion triggers:**
   - 50% exhausted → page on-call; prioritize reliability work over feature work.
   - 100% exhausted → feature freeze until budget resets or SLO is restored.
4. **Exceptions:** security incidents, force-majeure events, and scheduled maintenance do not consume error budget.
5. **Rollback expectation:** any release that consumes > 25% of the monthly budget in a single deploy must be rolled back automatically or manually.

## On-Call & Escalation

| Severity | Criteria | Response time | Escalation |
|---|---|---|---|
| SEV1 | Complete outage or data loss | 15 minutes | Page engineering + product |
| SEV2 | Major feature degraded | 1 hour | Page engineering |
| SEV3 | Minor degradation | 4 hours | Next business day |
| SEV4 | Cosmetic / low impact | Best effort | Backlog |

## Alert Routing

- **Slack:** #incidents for SEV2/SEV3, #war-room for SEV1.
- **PagerDuty:** on-call rotation for SEV1 and 50% error-budget burn.
- **Dashboards:** Grafana (`/observability/dashboards`) and Vercel Analytics.

## Review Log

| Date | SLO attainment | Error budget remaining | Notes |
|---|---|---|---|
| 2026-06-24 | — | 100% | Initial Cycle 1 SLOs defined |
| 2026-06-24 | — | 100% | Weekly review: no production traffic yet; runbooks, alert-tuning guide, and Kaizen log created; observability middleware wired and tested |
