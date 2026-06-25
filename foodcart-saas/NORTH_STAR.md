# North Star Metric: Foodcart SaaS

## North Star

**Weekly Active Site Engagement (WASE)**

> Percentage of published tenant sites that receive at least one meaningful customer interaction **or** owner update in a rolling 7-day window.

### Definition

A site is "actively engaged" in a given week if any of the following occur:
- A customer visits the public site (page load with user-agent not flagged as bot).
- A customer clicks a high-intent CTA: order link, directions, phone call, catering inquiry, or menu expansion.
- The owner (or AI assistant on their behalf) publishes or edits content.

### Formula

```
WASE = (published sites with ≥1 customer interaction or owner update in last 7 days)
       ------------------------------------------------------------
       (total published sites at start of the 7-day window)
```

### Rationale

We chose WASE because it captures the dual-sided value of the product:

1. **Customer value:** Hungry people are finding and interacting with the restaurant's site.
2. **Owner value:** The owner sees the site as a living asset worth updating, not a one-time brochure.

WASE is more actionable than raw signups (which ignore activation) and more balanced than revenue (which can be distorted by annual prepay or a single large customer). It also directly reflects the core product promise: a site that stays fresh and drives business.

### Why Not These Alternatives?

| Alternative | Why We Rejected It |
|---|---|
| Monthly Recurring Revenue (MRR) | Critical business metric, but lagging and can hide churn/activation problems early on. |
| Number of Sites Published | Measures output, not ongoing value. A published but abandoned site is a churn waiting to happen. |
| Weekly Active Owners | Captures owner engagement but misses whether the site is generating customer value. |
| AI Assistant Usage | Important adoption metric, but not all owners need AI every week; could drive the wrong incentives. |
| Total Site Visitors | Too easily inflated by bots or one-time spikes; doesn't reflect owner engagement or conversion. |

## Sub-Metrics

These metrics explain *why* WASE moves and guide squad focus.

### Activation

| Metric | Definition | Target | Owner |
|---|---|---|---|---|
| Time to Publish | Median minutes from signup to published site | < 10 min | Product + UX |
| Publish Rate | % of signups that publish a site within 24 hours | > 60% | Product + UX |
| First-Week Edit Rate | % of published sites with ≥1 owner or AI edit in first 7 days | > 40% | Product |

### Engagement

| Metric | Definition | Target | Owner |
|---|---|---|---|---|
| Customer CTA Click Rate | % of site visitors who click order/directions/phone/catering | > 8% | Product |
| AI Edit Adoption | % of active owners who use AI assistant in a 30-day window | > 35% | Product |
| Menu View Rate | % of site visitors who expand or view the full menu | > 50% | UX |

### Retention

| Metric | Definition | Target | Owner |
|---|---|---|---|---|
| 30-Day Owner Retention | % of owners who return to dashboard within 30 days of publish | > 55% | Product |
| 90-Day Site Retention | % of published sites still active after 90 days | > 50% | Product |
| AI-Assisted Retention | 30-day retention of owners who used AI vs. those who did not | AI +20 pp | Data Analyst |

### Business

| Metric | Definition | Target | Owner |
|---|---|---|---|---|
| Free-to-Pro Conversion | % of free sites converting to paid within 30 days | > 12% | Product |
| Average Revenue Per User (ARPU) | MRR / number of paying customers | > $35 | Product |
| Catering Lead Rate | % of active sites generating ≥1 catering lead per quarter | > 15% | Product |

## Instrumentation

- Public site events: Plausible or Segment with tenant-scoped event properties.
- Owner dashboard events: PostHog or Amplitude with user/tenant IDs.
- AI assistant events: Backend audit log plus frontend telemetry (prompt category, approval/rejection, change type).
- WASE calculated in nightly job and surfaced in `METRICS.md` dashboard.

## Review Cadence

- **Daily:** Time to publish and publish rate during onboarding experiments.
- **Weekly:** WASE and sub-metrics in squad review.
- **Monthly:** North Star target recalibration and cohort analysis.
- **Quarterly:** Strategic review with leadership; consider whether WASE still best captures product-market fit.
