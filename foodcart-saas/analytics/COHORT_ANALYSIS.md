# Cohort Analysis: Foodcart SaaS

*Framework for segmenting food-cart and small-restaurant owners by behavior.*

---

## Why cohorts matter for Foodcart SaaS

Foodcart owners are not a single segment. A solo taco cart, a family-run Indian counter, and a growing three-location mini-chain have different jobs, cadences, and willingness to engage with software. Cohort analysis lets us distinguish **activation problems** (owners sign up but never publish) from **retention problems** (owners publish but abandon the site) and from **expansion problems** (engaged owners who need more locations or features).

---

## Primary cohort dimensions

### 1. Acquisition cohort (time-based)

| Cohort | Definition | Primary question |
|---|---|---|
| Weekly signup cohort | Owners who signed up in the same calendar week | Is activation improving as the product matures? |
| Release cohort | Owners who signed up in the 7 days after a release | Did a specific release move onboarding or publish rate? |

### 2. Activation cohort

| Segment | Definition | Signal |
|---|---|---|
| Quick publishers | Publish within 10 minutes of signup | Strong product-market fit signal; high expected retention |
| 24-hour publishers | Publish within 24 h but > 10 min | Viable but may indicate friction in onboarding or ingestion |
| Non-publishers | Sign up but never publish | Largest activation risk; needs funnel diagnosis |

### 3. Engagement cohort

| Segment | Definition | Signal |
|---|---|---|
| AI-assisted owners | Used AI assistant at least once in 30 days | Expected +20 pp retention per `NORTH_STAR.md`; watch trust metrics |
| Manual-only owners | Edit only through forms/UI | Baseline engagement; compare retention to AI-assisted |
| Passive publishers | Site is live but no owner edits in 30 days | Churn risk; target with re-engagement or simplified edits |

### 4. Business-type cohort

| Segment | Examples | Typical needs |
|---|---|---|
| Solo cart | Single owner, no employees | Speed, mobile-only workflow, low cost |
| Family/counter-service | Mis Abuelos-style, 1 location | Warm branding, catering, local SEO |
| Mini-chain | 2–5 locations | Consistent hours/menu, multi-location dashboard |
| Delivery-first | Heavy DoorDash/UberEats/Grubhub presence | Prominent order links, click-share analytics |

### 5. Template cohort

| Segment | Definition | Question |
|---|---|---|
| Banh Mi Fusion users | Chose bold/diagonal template | Does bold design correlate with CTA click rate? |
| Real Indian Food users | Chose warm/heritage template | Does storytelling correlate with catering leads? |
| Mis Abuelos users | Chose family/Mexican warmth template | Does warmth design correlate with owner retention? |

### 6. Tenure cohort

| Segment | Definition | Question |
|---|---|---|
| Week 0–1 | Newly published | Can we drive first customer engagement? |
| Week 2–4 | Early retention window | Are owners returning to edit hours/menu/specials? |
| Month 2–3 | Habit formation window | Is the site becoming a living asset? |
| Month 6+ | Long-term | Are they expanding to catering, custom domains, or multi-location? |

---

## Core retention curves to compute

| Curve | Formula | Decision use |
|---|---|---|
| Owner retention | % of signup cohort still active at week N | Overall product health |
| Site retention | % of published sites still published at week N | Churn / unpublish signal |
| WASE retention | % of published sites with WASE activity at week N | True value delivery |
| AI-assisted retention | Retention of AI users vs. non-AI users in same cohort | Validate AI assistant ROI |

---

## Segment comparison table

Compare each cohort on these metrics every month:

| Metric | Solo cart | Family/counter | Mini-chain | Delivery-first |
|---|---|---|---|---|
| Median time to publish | | | | |
| 24-hour publish rate | | | | |
| 30-day owner retention | | | | |
| WASE | | | | |
| Customer CTA click rate | | | | |
| Catering lead rate | | | | |
| AI edit adoption | | | | |

---

## Actionable cohort-driven hypotheses

| Observation | Hypothesis | Follow-up |
|---|---|---|
| Mini-chain owners have lower publish rate | Onboarding is too solo-operator focused | Run 3 mini-chain task-based tests |
| AI-assisted owners retain +20 pp | AI lowers editing friction | A/B test AI prompt placement in dashboard |
| Delivery-first segment has low CTA click rate | Order links are buried or generic | Test prominent "Order" button variants |
| Week-2 owners stop editing | Owners don't know what to update next | Add " suggested updates" or seasonal prompts |
| Non-publishers spike after a release | A release broke onboarding | Funnel analysis + rollback review |

---

## Data sources

- **Signup / publish / tenant data:** PostgreSQL `tenants`, `sites`, `revisions` tables.
- **Public site behavior:** Plausible or Segment events with `tenant_id`.
- **Dashboard behavior:** PostHog or Amplitude with user/tenant IDs.
- **AI assistant:** Backend audit log (`ai_requests`, `revisions`) + frontend telemetry.
- **External signals:** Google Business Profile import success/failure, link ingestion health.

---

## Review cadence

- **Weekly:** Time-to-publish and publish rate by acquisition cohort during launch.
- **Monthly:** Retention curves and segment comparison table.
- **Quarterly:** Segment definitions refresh; validate that business-type labels still predict behavior.
