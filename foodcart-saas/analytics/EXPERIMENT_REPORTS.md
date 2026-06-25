# Experiment Reports: Foodcart SaaS

*Template and Cycle 1 release experiment record.*

---

## Cycle 1 Release Experiment — Progressive Delivery Rings

### Overview

| Field | Value |
|---|---|
| **Experiment ID** | EXP-001 |
| **Name** | Cycle 1 MVP progressive delivery (Banh Mi Fusion, Real Indian Food, Mis Abuelos templates + onboarding + live hours) |
| **Hypothesis** | Releasing Cycle 1 behind feature flags and progressive rings will keep error rate < 0.1% while validating that real food-cart owners can publish a site in < 10 minutes. |
| **Owner** | Data Analyst |
| **Status** | Planned — awaiting first production deploy |
| **Start date** | TBD |
| **End date** | TBD (rings complete + 7-day hold) |

### What is being released

- Clerk-based signup and tenant provisioning (`slug.foodcartsite.com`).
- Onboarding wizard with Google Business Profile / link ingestion and manual fallback.
- Three food-native templates: Banh Mi Fusion, Real Indian Food, Mis Abuelos.
- Public single-page site with hero, story, menu, locations/hours, catering, contact, social, and order links.
- Live open/closed badge with timezone-aware hours editor.
- Admin dashboard for preview, publish/unpublish, and business-info edits.
- AI Website Assistant (prompt → structured preview → approve/reject) behind a feature flag.

### Variables

| Variable | Treatment | Control |
|---|---|---|
| **Feature flag state** | New features enabled for the ring | Features off (existing behavior) |
| **Traffic ring** | Ring 0 → Ring 1 → Ring 2 → Ring 3 | N/A |

### Progressive delivery rings

| Ring | Audience | Duration | Entry gate | Exit gate |
|---|---|---|---|---|
| Ring 0 | Internal team and pilot owners (5–20 users) | 24–48 h | Deploy candidate tagged and smoke tests pass | Zero SEV1/SEV2 incidents; WASE baseline captured |
| Ring 1 | 1–5% of new signups | 24–48 h | Ring 0 healthy | Error rate < 0.1%; p95 latency < 300 ms; publish rate non-negative vs. Ring 0 |
| Ring 2 | 10–25% of new signups | 24–48 h | Ring 1 healthy | Same as Ring 1 + median time-to-publish < 15 min |
| Ring 3 | General availability | Ongoing | Ring 2 healthy | Feature flag kept for 7-day hold, then cleaned up |

### Metrics

#### Primary

| Metric | Baseline | Success criterion |
|---|---|---|
| WASE | TBD after Ring 0 | No regression; target ≥ 35% after Ring 3 |
| 24-hour publish rate | TBD after Ring 0 | > 60% by end of Ring 3 |
| Error rate (5xx) | TBD | < 0.1% during each ring |

#### Secondary / Guardrail

| Metric | Baseline | Success criterion |
|---|---|---|
| API p95 latency | TBD | < 300 ms |
| LCP (p75) | TBD | < 2.5 s |
| Median time to publish | TBD | < 10 min |
| AI assistant usage (if enabled) | 0% | > 10% of active owners by end of Ring 3 |
| Rollback events | 0 | ≤ 1 per ring |

### Analysis plan

1. Compare each ring against the prior ring, not against a separate control group (quasi-experimental).
2. Use percentile metrics for latency and web vitals; report confidence intervals for conversion rates when sample size allows.
3. Segment publish rate and WASE by template, ingestion success/failure, and device type.
4. Document any incident or rollback as a feature interaction, not just an engineering event.

### Rollback triggers

| Trigger | Action |
|---|---|
| Error rate > 0.5% for 5 minutes | Auto-rollback canary + disable feature flag |
| API p95 latency > 500 ms for 5 minutes | Page on-call; consider rollback |
| SEV1/SEV2 incident attributed to release | Immediate rollback + post-mortem |
| 24-hour publish rate drops > 15 pp vs. prior ring | Pause ring expansion; investigate UX funnel |
| Any unauthorized AI assistant action | Disable AI flag globally; security review |

### Feature flag cleanup

- Remove Ring 1/2/3 flags within 30 days of full rollout.
- Maintain fewer than 20 active flags per service.
- Keep an emergency kill switch for AI assistant until SPIKE-005 red-team criteria are re-validated in production.

---

## EXP-002 — Onboarding Template Smart Default

### Overview

| Field | Value |
|---|---|
| **Experiment ID** | EXP-002 |
| **Name** | Onboarding template smart default vs. manual selection |
| **Hypothesis** | Pre-selecting a template based on cuisine type (or showing a single recommended default with a confirm/swap option) will reduce decision friction and increase the 24-hour publish rate by at least 10 percentage points, without reducing owner brand-match rating. |
| **Owner** | Data Analyst |
| **Status** | Planned — first post-launch experiment |
| **Start date** | TBD (after Ring 2 GA and stable baseline) |
| **End date** | TBD (when sample reaches ≥ 200 completed onboardings per arm or 2 weeks, whichever is later) |

### Why this experiment

The Cycle 1 onboarding wizard requires every owner to choose among three visually distinct templates (Banh Mi Fusion, Real Indian Food, Mis Abuelos). For time-pressed food-cart owners, this choice may be a source of friction. A smart default should preserve autonomy (owners can still swap) while reducing cognitive load.

### What changed

| Variable | Treatment A | Treatment B | Control |
|---|---|---|---|
| **Template selection** | Cuisine-matched smart default; owner taps "Looks good" or "Swap" | Single recommended default; "Browse all" as secondary action | Current manual 3-template grid |

*Cuisine matching logic (Treatment A):* Map onboarding "cuisine type" to a suggested template using a simple deterministic table (e.g., Vietnamese → Banh Mi Fusion, Indian → Real Indian Food, Mexican → Mis Abuelos). For unmatched cuisines, fall back to the most popular template in the cohort.

### Audience

- New signups reaching the template-selection step of onboarding.
- Randomized 1:1:1 into Control / Treatment A / Treatment B at the point of template selection.
- Exclude internal team accounts and pilot owners already exposed to the manual grid.

### Metrics

#### Primary

| Metric | Definition | Baseline | Success criterion |
|---|---|---|---|
| 24-hour publish rate | % of signups who publish within 24 h | Ring 2 GA baseline | ≥ +10 pp on either treatment vs. control |
| Median time to publish | Minutes from signup to published site | Ring 2 GA baseline | < 10 min; ≥ 15% improvement on treatment |

#### Secondary / Guardrail

| Metric | Definition | Baseline | Success criterion |
|---|---|---|---|
| Template swap rate | % of treatment users who change the default | N/A | < 30% (default is acceptable) |
| Onboarding completion rate | % reaching preview/publish step | Ring 2 GA baseline | No regression |
| Owner brand-match rating | % rating site "good" or "great" post-publish | Ring 2 GA baseline | < 5 pp drop vs. control |
| LCP | p75 Largest Contentful Paint | Ring 2 GA baseline | No regression > 100 ms |

### Analysis plan

1. Use intent-to-treat analysis: all users randomized to an arm are analyzed in that arm.
2. Report conversion rates with Wilson score confidence intervals.
3. Segment by cuisine type, device type, and ingestion success/failure to detect heterogeneous treatment effects.
4. If Treatment A and B both succeed, run a follow-up pairwise comparison to pick the winning variant.

### Rollback / pause triggers

| Trigger | Action |
|---|---|
| 24-hour publish rate drops > 5 pp vs. control | Pause experiment; investigate UX funnel |
| Brand-match rating drops > 10 pp vs. control | Stop treatment arms; revert to control |
| Default-matching bug assigns wrong template category | Stop experiment; fix matching logic |
| Sample imbalance > 10% between arms | Rebalance or restart randomization |

### Decision framework

- **Ship:** One treatment hits +10 pp publish-rate target with no guardrail regression.
- **Iterate:** Directionally positive but not significant; refine matching logic or default presentation.
- **Rollback:** No improvement or guardrail regression; keep manual grid.

### Follow-up experiments

- EXP-003: Hero CTA order-link prominence (depends on active published-site count).
- EXP-004: AI assistant prompt placement (depends on Cycle 2 AI GA).

---

### Report template

Use this section for each future experiment:

```markdown
## EXP-XXX — Experiment Name

### Overview
- ID:
- Hypothesis:
- Owner:
- Status:
- Date range:

### What changed
- Treatment:
- Control:

### Metrics
| Metric | Baseline | Treatment | Delta | Significance |
|---|---|---|---|---|
| ... | ... | ... | ... | ... |

### Decision
- Ship / Iterate / Rollback
- Flags to clean up:
- Follow-up experiments:
```
