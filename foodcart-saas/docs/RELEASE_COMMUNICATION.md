# Release Communication Plan — Foodcart SaaS Cycle 1

| Attribute | Value |
|---|---|
| **Release** | Cycle 1 — MVP Foundation |
| **Owner** | Product Owner |
| **Co-owners** | Tech Lead, DevOps/SRE, Data Analyst, UX Researcher |
| **Target GA date** | 2026-07-01 (pending ring progression) |
| **Status** | Ring 0 in progress |

---

## Objectives

1. **Decouple deployment from release** — code is in production, but customer exposure is controlled and reversible.
2. **Minimize blast radius** — catch issues in internal Ring 0 before any pilot sees them.
3. **Validate core metrics** — prove 10-minute publish and live hours accuracy with real owners.
4. **Keep stakeholders informed** — no surprises for leadership, support, or sales.

---

## Internal team rollout plan

### 1. Pre-release freeze (24 hours before Ring 0)

| Action | Owner | Done when |
|---|---|---|
| Merge freeze for non-critical changes | Tech Lead | No new feature merges to `main` |
| Confirm CI, security scans, and staging smoke tests are green | DevOps/SRE | `deploy.yml` last run succeeded |
| Confirm canary analysis script and rollback runbook are tested | DevOps/SRE | Dry-run completed; rollback <15 min |
| Confirm Grafana / Vercel Analytics dashboards show baseline | Data Analyst | Dashboard links posted in `#foodcart-releases` |
| Confirm support channel and on-call rotation are active | Product Owner | `#incidents` and PagerDuty verified |
| Prepare release notes and pilot recruitment list | Product Owner | `docs/RELEASE_NOTES.md` + pilot tracker ready |

### 2. Ring 0 — internal team (5–20 users, 24–48 hours)

- **Audience:** squad members, design partners, and friendly internal users.
- **What to test:**
  - Signup → slug provisioning → onboarding → template selection → publish.
  - Edit hours in admin and verify live badge updates.
  - Tenant isolation (cannot see another tenant's data).
  - Mobile and desktop preview.
- **Entry criteria:** staging smoke tests pass; no open SEV1/SEV2 issues.
- **Exit criteria:** ≥3 successful end-to-end publishes; zero wrong-hours bugs; error rate <0.1%.
- **Communication:** daily check-ins in `#foodcart-releases`; blockers escalated to Tech Lead + Product Owner.

### 3. Ring 1 — pilot customers (1–5% of invite list, ~24 hours)

- **Audience:** 3–5 pre-recruited pilot food-cart owners.
- **Traffic:** flags enabled for selected pilot slugs only.
- **What to validate:**
  - Median time to publish < 10 minutes.
  - Owner can complete onboarding without support intervention.
  - Live hours badge matches owner-verified hours.
  - Brand-match rating ≥ 70%.
- **Entry criteria:** Ring 0 exit criteria met; canary error rate <0.1%; p95 API latency <300 ms; no SLO violations.
- **Exit criteria:** pilot onboarding sessions completed; feedback logged; no SEV2+ incidents.

### 4. Ring 2 — expanded pilot (10–25% of invite list, 24–48 hours)

- **Audience:** 10–15 pilot owners.
- **What to validate:**
  - 24-hour publish rate ≥ 60%.
  - Mobile Core Web Vitals LCP < 2.5 s on real devices.
  - Zero wrong-hours complaints.
- **Entry criteria:** Ring 1 stable for 24 hours.
- **Exit criteria:** metrics meet targets or rollback decision made.

### 5. Ring 3 — general availability

- **Audience:** all invited / waitlisted owners.
- **Entry criteria:** Ring 2 stable for 24–48 hours; no unresolved SLO violations; Data Analyst confirms dashboards are healthy.
- **Communication:**
  - Internal `#foodcart-releases` announcement.
  - Email to pilot participants thanking them and sharing next steps.
  - Changelog posted in public docs / Notion.

---

## Rollback and halt triggers

Rollback or halt the rollout immediately if any of the following occur:

- 5xx error rate > 0.5% for 5 minutes.
- API p95 latency > 500 ms for 5 minutes.
- Public site LCP > 4 s for 5 minutes.
- Any SEV1 or SEV2 incident attributed to the release.
- Any confirmed tenant-isolation failure.
- Any verified wrong-hours complaint from a pilot customer.
- Error budget > 25% consumed in a single deploy (per `docs/SLOs.md`).

**Rollback procedure:** see `docs/DEPLOYMENT.md` → "Rollback Procedure."

---

## Pilot customer criteria

### Ideal pilot profile

- Owns and operates a food cart, food truck, or small counter-service restaurant.
- Has an active Google Business Profile **or** Yelp listing (helps validate ingestion).
- Operates a single location in a US timezone (Cycle 1 does not support multi-location).
- Uses a smartphone as a primary business device.
- Willing to complete a 10-minute onboarding session and a 15-minute feedback interview.
- Comfortable with English for Cycle 1 (internationalization deferred).
- Not currently a paying customer (free pilot, no billing in Cycle 1).

### Exclusion criteria

- Multi-location mini-chains (defer to Cycle 2).
- Businesses that require custom domains or white-label branding immediately.
- Owners who need PDF/image menu auto-extraction as a hard requirement.
- Businesses outside the supported timezone coverage.

### Recruitment target

| Ring | Target pilots | Source |
|---|---|---|
| Ring 1 | 3–5 | Existing interview participants from `DISCOVERY/INTERVIEW_NOTES/` |
| Ring 2 | 10–15 | Personal network, local food-cart pods, social outreach |
| Ring 3 | Waitlist | Landing-page signups |

### Pilot commitment

- One 10-minute onboarding session (recorded with consent or observed live).
- One 15-minute feedback call within 7 days of publish.
- Permission to use anonymized quotes / metrics internally.
- In exchange: free lifetime use of Cycle 1 features; priority access to Cycle 2 AI assistant beta.

---

## External announcement plan

### Tone and positioning

- **Soft launch.** Cycle 1 is a validation release, not a broad marketing moment.
- Position Foodcart SaaS as the fastest way for food carts to get online and keep hours accurate.
- Do **not** announce the AI assistant until Cycle 2; it is not customer-facing yet.

### Channels and timeline

| Date | Channel | Message | Owner |
|---|---|---|---|
| Ring 0 start | `#foodcart-releases` (internal) | Release deployed; Ring 0 testing begins | Product Owner |
| Ring 1 start | `#foodcart-pilots` + email to recruited pilots | Personal invite to try the new builder; scheduling link | Product Owner |
| Ring 2 start | `#foodcart-pilots` + personal outreach | Expanded pilot open; feedback request | Product Owner |
| GA | `#foodcart-releases` + changelog | Cycle 1 GA; known issues; next steps | Product Owner |
| GA + 1 week | Company blog / LinkedIn (optional) | Soft public launch: "How food carts can publish a site in 10 minutes" | Marketing (if available) |

### What **not** to do in Cycle 1

- No Product Hunt launch.
- No paid advertising.
- No press release.
- No promise of AI assistant, custom domains, or billing.

---

## Stakeholder update cadence

| Stakeholder | What they need | Cadence | Channel |
|---|---|---|---|
| Leadership / exec sponsors | Ring status, metric attainment, blockers | Every ring transition + weekly | Email or `#foodcart-leadership` |
| Engineering / SRE | Error rates, latency, canary status, incidents | Real-time | `#incidents`, PagerDuty |
| UX Researcher | Pilot interview schedule and qualitative feedback | Daily during Ring 1/2 | `#foodcart-pilots` |
| Data Analyst | Dashboard health, funnel metrics, WASE baseline | Daily during rollout | `#foodcart-releases` |
| Customer support (future) | Known issues, pilot commitments | At GA | Notion / Slack |

---

## Data Analyst confirmation checklist

Before Ring 3, the Data Analyst must confirm:

- [ ] Onboarding funnel events are flowing correctly (signup → publish).
- [ ] WASE baseline is measurable.
- [ ] Hours-badge impression and edit events are instrumented.
- [ ] Public site CTA click events are instrumented.
- [ ] Grafana / Vercel Analytics dashboards are accessible and alarm-free.
- [ ] Rollback thresholds are visible on the SLO dashboard.

---

## Related documents

- `docs/RELEASE_NOTES.md` — what is in the release.
- `docs/DEPLOYMENT.md` — deployment, canary, and rollback mechanics.
- `docs/SLOs.md` — alert thresholds and error budget.
- `BACKLOG.md` — post-release work and Cycle 2 commitments.
- `docs/STAKEHOLDER_DECISION_LOG.md` — release go/no-go criteria and accepted risks.
