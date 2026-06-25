# Metrics: Foodcart SaaS

*Cycle 1 baseline. Last updated: 2026-06-24 — Cycle 1 Week 1 review added; runbooks, Kaizen log, and observability wiring updated.*

> **Note on baselines:** Foodcart SaaS has not yet been deployed to production, so DORA and product metrics below are either synthetic placeholders or derived from CI/test data. Replace with live telemetry as soon as the first production tenant is onboarded.

---

## Cycle 1 Week 1 Review

*Review date: 2026-06-24. Scope: first weekly Observe & Improve review after Cycle 1 release cut.*

### Baseline metrics

| Category | Metric | Current | Target | Signal |
|---|---|---|---|---|
| North Star | WASE | TBD (no published tenants) | ≥ 35% | Will establish after Ring 0 pilot |
| Activation | 24-hour publish rate | TBD | > 60% | Leading indicator of retention |
| Activation | Median time to publish | TBD | < 10 min | Onboarding friction proxy |
| Engagement | Customer CTA click rate | TBD | > 8% | Public site value delivery |
| Reliability | 5xx error rate | TBD | < 0.1% | SLO gate for ring expansion |
| Reliability | API p95 latency | TBD | < 300 ms | Golden signal |
| Quality | Backend test coverage | **95.11%** | ≥ 80% | ✅ Above target |
| Quality | Frontend test coverage | **69.2%** | ≥ 80% | ⚠️ Below target; scaffold pages drag number down |
| Quality | Unit + E2E pass rate | **100%** | 100% | ✅ CI green |
| Security | CRITICAL/HIGH findings | **0** | 0 | ✅ All scans pass |

### CI-derived quality metrics

- **Backend tests:** 251 passed, 2 xfailed, 1 xpassed; line coverage 95.11% (scoped to Foodcart modules).
- **Frontend tests:** vitest suite passed; overall line coverage 69.2%. Coverage is depressed by legacy scaffold pages/config files (many at 0%). Foodcart-specific components such as `OnboardingStepper` and public-site theme/hours libraries are well covered (>90%).
- **Lint / typecheck:** Backend lint and mypy clean; frontend typecheck clean; frontend lint has 4 non-blocking warnings about `<img>` elements in `TemplateSelector.tsx` (LCP/bandwidth concern, not a security issue).
- **Security scans:** Bandit, Semgrep, Trivy, dependency review, TruffleHog, and CodeQL all passed with no CRITICAL/HIGH findings.

### Bottlenecks and opportunities identified

1. **Frontend coverage gap.** The 69.2% overall figure masks strong coverage of new Foodcart code and zero coverage of legacy scaffold. The gap is expected to close as scaffold pages are removed or replaced, but it is a regression risk if new UI code lands without tests.
2. **Template selection friction.** The onboarding wizard requires owners to choose among three templates manually. Early pilot task-based tests may reveal decision fatigue; a smart-default experiment is queued as EXP-002.
3. **Image handling.** Frontend lint warnings flag unoptimized `<img>` tags. This is a known LCP risk and should be monitored with Core Web Vitals after launch.
4. **AI assistant is behind a flag.** No usage data exists yet; adoption and trust metrics are the first post-flag priorities.

### Metrics to watch after launch

- **Daily during Ring 0–1:** 24-hour publish rate, onboarding completion rate, 5xx error rate, AI assistant propose/approve events.
- **Weekly:** WASE, API p95 latency, LCP/INP/CLS, CTA click rate, owner brand-match rating.
- **Per release:** DORA deployment frequency, lead time, change failure rate, recovery time.
- **Monthly:** Cohort retention curves, AI-assisted vs. manual-only retention, template/business-type segment comparison.

*Action item:* Replace all "TBD" product and DORA values with live telemetry after the first production deployment and first 50 published tenants.

---

## North Star

| Metric | Definition | Current | Target | Owner |
|---|---|---|---|---|
| Weekly Active Site Engagement (WASE) | % of published tenant sites with ≥1 customer interaction or owner update in the last 7 days | TBD (no published tenants) | ≥ 35% | Product Strategist |

See `NORTH_STAR.md` for the full definition, sub-metrics, rationale, and instrumentation plan.

---

## DORA Metrics

| Metric | Definition | Current | Target | Data Source |
|---|---|---|---|---|
| Deployment Frequency | Production deployments per week | 0 (baseline) | On demand (multiple/day) | GitHub Actions `deploy.yml` |
| Lead Time for Changes | Median time from PR merge to production | TBD | < 1 day | GitHub API + deploy events |
| Change Failure Rate | % of production deploys causing an incident/rollback | 0% (baseline) | < 5% | Incident tags / rollback events |
| Failed Deployment Recovery Time | Median time from incident detection to recovery | TBD | < 1 hour | Incident data + rollback duration |

### DORA interpretation for Cycle 1

- We are at the start of the delivery pipeline; the first production deploy will establish the real baseline.
- CI passes and the deploy workflow is configured with a 5% canary, auto-rollback on failure, and a release tag. These mechanisms are designed to keep CFR low and recovery time short once live traffic exists.

---

## Flow Metrics

| Metric | Definition | Current | Target | Data Source |
|---|---|---|---|---|
| WIP | Work-in-progress backlog items | 2 committed bets + 1 spike | Team size + 1 per stage | `BACKLOG.md` / board |
| Cycle Time | Median days from item start to "Done" | TBD | < 5 days | Board timestamps |
| Throughput | Items completed per week | TBD | TBD after 2 sprints | Board velocity |
| Flow Efficiency | Process time / total lead time | TBD | > 10% | VSM analysis |

---

## Quality Metrics

| Metric | Definition | Current | Target | Data Source |
|---|---|---|---|---|
| Backend Test Coverage | Line coverage of Cycle 1 Foodcart modules | 95.11% | ≥ 80% | pytest (scoped in `pyproject.toml`) |
| Frontend Test Coverage | Overall line coverage (entire frontend tree) | 69.2% | ≥ 80% | vitest (`src/frontend/coverage/coverage-summary.json`) |
| Unit Test Pass Rate | % passing on `main` | 100% | 100% | CI `ci.yml` |
| E2E Pass Rate | % passing on `main` | 100% | 100% | CI `_ci-e2e-real.yml` |
| Security Scan Findings | Open CRITICAL/HIGH | 0 | 0 | Trivy / Bandit / Semgrep |
| Bug Escape Rate | Bugs found in production / total bugs | TBD | < 10% | Issue tracker |

### Coverage notes

- Backend coverage is scoped to the new Foodcart modules; scaffold code is excluded so the gate measures the feature under construction.
- Frontend overall coverage is 69.2% because it still includes legacy scaffold pages/config files (many at 0%). As Foodcart-specific pages replace scaffold code, this number is expected to converge toward the backend level.

---

## UX Metrics: HEART + Core Web Vitals

### HEART

| Dimension | Metric | Definition | Current | Target | Data Source |
|---|---|---|---|---|---|
| **H**appiness | Owner brand-match rating | % rating generated site "good" or "great" | TBD | ≥ 70% | Post-publish micro-survey |
| **E**ngagement | Weekly Active Site Engagement (WASE) | % published sites active in last 7 days | TBD | ≥ 35% | Analytics nightly job |
| **A**doption | 24-hour publish rate | % signups that publish within 24 h | TBD | > 60% | Onboarding funnel |
| **R**etention | 30-day owner retention | % owners returning to dashboard within 30 days of publish | TBD | > 55% | Product analytics |
| **T**ask success | Median time to publish | Minutes from signup to published site | TBD | < 10 min | UX task-based tests |

### Core Web Vitals

| Metric | Definition | Current | Target | Data Source |
|---|---|---|---|---|
| LCP | Largest Contentful Paint (p75) | TBD | < 2.5 s | Chrome UX Report / Vercel Analytics |
| INP | Interaction to Next Paint (p75) | TBD | < 200 ms | Chrome UX Report |
| CLS | Cumulative Layout Shift (p75) | TBD | < 0.1 | Chrome UX Report |

### Additional UX diagnostics

| Metric | Definition | Target | Data Source |
|---|---|---|---|
| Customer CTA Click Rate | % visitors clicking order/directions/phone/catering | > 8% | Public site events |
| Menu View Rate | % visitors expanding or viewing full menu | > 50% | Public site events |
| AI Edit Adoption | % active owners using AI assistant in 30 days | > 35% | Dashboard + audit log |
| AI-Assisted Retention | 30-day retention: AI users vs. non-users | AI +20 pp | Cohort analysis |

---

## Reliability Metrics (SLO-aligned)

| Metric | Definition | Target | Data Source |
|---|---|---|---|
| API availability | % successful HTTP responses (2xx/3xx) | 99.9% over 30 days | Prometheus / access logs |
| API p95 latency | p95 response time | < 300 ms | Prometheus histograms |
| 5xx error rate | 5xx / total responses | < 0.1% over 30 days | Access logs / APM |
| AI assistant p95 latency | End-to-end structured change proposal | < 5 s | OpenTelemetry traces |
| Saturation | DB pool / CPU / memory / disk p95 utilization | < 80% | PostgreSQL + Vercel metrics |

See `docs/SLOs.md` for full SLOs, error-budget policy, and alert thresholds.

---

## Review Cadence

- **Daily:** Time to publish and publish rate during onboarding experiments.
- **Weekly:** DORA, flow, and reliability metrics in squad review.
- **Monthly:** North Star, UX metrics, and cohort analysis with leadership.
- **Quarterly:** Full metrics audit and target recalibration.
