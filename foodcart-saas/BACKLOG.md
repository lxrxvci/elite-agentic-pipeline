# Backlog: Foodcart SaaS

*Ranked, estimated, and categorized backlog. Shaped bets are in `docs/SHAPED_BETS.md`. Capacity and sequencing are in `CAPACITY_PLAN.md`. Release notes and communication are in `docs/RELEASE_NOTES.md` and `docs/RELEASE_COMMUNICATION.md`.*

---

## Definition of Done (Global)

Every backlog item that reaches "Done" must meet the following:

1. **Code & Quality**
   - Merged to trunk via small, reviewed PR.
   - Unit + integration tests written; coverage does not regress below current baseline (target ≥ 80%).
   - Lint, typecheck, and security scans pass in CI.
   - No known CRITICAL/HIGH security findings.

2. **Observability & SLOs**
   - Relevant metrics/events instrumented (WASE, funnel, errors, latency).
   - Feature flagged or measured against SLOs in `docs/SLOs.md`.

3. **Documentation**
   - API changes reflected in `openapi.yaml`.
   - Runbook or admin-facing help text updated if user-facing behavior changes.
   - ADR/RFC created for any new architectural decision.

4. **Validation**
   - Acceptance criteria are demonstrably met in staging.
   - For user-facing items: UX Researcher or Product Owner signs off on a demo or task-based test.

---

## Improvement Experiments — Cycle 2

*Evidence-driven experiments derived from Cycle 1 build and review (`METRICS.md`, `docs/SHAPED_BETS.md`, and interview synthesis). Each experiment is a small, de-risked bet with a clear success metric. Findings feed the next shaping cycle.*

| ID | Experiment | Evidence | Hypothesis | Success Metric(s) | Expected Outcome | Owner |
|---|---|---|---|---|---|---|
| **EXP-001** | **Smart template default / vibe quiz** | `METRICS.md` bottleneck #2 flags template-selection friction; `DISCOVERY/INTERVIEW_SYNTHESIS.md` T7 shows owners care about brand vibe. | Pre-selecting or guiding a template choice reduces decision fatigue and shortens onboarding. | Median time to publish; 24-hour publish rate; owner brand-match rating. | ≥20% reduction in median time-to-publish; 24-hour publish rate ≥65%; brand-match rating ≥70%. | Product Strategist + UX Researcher |
| **EXP-002** | **Image optimization blitz** | `METRICS.md` notes unoptimized `<img>` tags in `TemplateSelector.tsx` and LCP as a launch risk; Core Web Vitals target <2.5s. | Switching to optimized images (Next.js Image, R2 transforms) improves perceived speed and CTA click-through. | Mobile LCP p75; CTA click rate; image payload size. | LCP <2.0s on mobile; CTA click rate ≥8%; zero LCP regressions. | Frontend Engineer + UX |
| **EXP-003** | **Onboarding progress saver + resume nudge** | `METRICS.md` shows 24-hour publish rate is TBD but a leading retention indicator; owners are frequently interrupted during service shifts. | Saving onboarding state and sending a quick resume nudge increases completion without adding friction. | Onboarding completion rate; 24-hour publish rate; step-level drop-off. | +10 pp 24-hour publish rate; ≥30% reduction in drop-off at the template/preview step. | Product Strategist + Frontend |
| **EXP-004** | **AI assistant trust nudges** | Interview synthesis T6/T9: owners fear breaking the site; `docs/ADR/0003-ai-assistant-harness.md` defines guardrails; `METRICS.md` notes AI is behind a flag with no usage data. | Visible guardrail explanations, clear diff previews, and one-click revert increase adoption and trust. | AI edit adoption; proposal acceptance rate; SUS / trust rating. | ≥35% of active owners use AI in first 30 days; ≥80% proposals approved without rework; SUS ≥70. | Product Strategist + UX Researcher |
| **EXP-005** | **Hours accuracy verification nudge** | `DISCOVERY/INTERVIEW_SYNTHESIS.md` T4: wrong hours are a top-3 pain; Bet 2 targets 0 wrong-hours complaints in 30 days. | A post-publish nudge to verify imported hours reduces complaints and reinforces trust. | Wrong-hours complaints; open/closed badge accuracy; customer CTA click rate. | 0 wrong-hours complaints in first 30 days; 100% badge accuracy vs. owner-verified hours; CTA click rate non-negative. | Product Strategist + UX |

---

## Released — Cycle 1

### Bet 1 — 10-Minute Publish Onboarding

| Field | Detail |
|---|---|
| **Status** | **Released** — progressive rollout in progress; pilot validation ongoing |
| **Outcome** | Solo operators publish a complete site quickly. |
| **Customer outcome** | Owner gets online before their next shift without frustration. |
| **Business outcome** | High activation → higher 30-day retention; 24-hour publish rate > 60%. |
| **Evidence** | `DISCOVERY/INTERVIEW_NOTES/2026-06-24_maria_tacos.md`, `DISCOVERY/INTERVIEW_NOTES/2026-06-24_raj_curry.md`, `DISCOVERY/INTERVIEW_SYNTHESIS.md` |
| **Appetite** | 6 weeks (calendar); ~15 engineer-weeks |
| **Sequence** | Weeks 1–6; validation/polish weeks 7–8 |
| **North Star link** | WASE activation: Time to Publish < 10 min; Publish Rate > 60% |

#### Acceptance Criteria

- [x] New user signs up via Clerk and a unique `slug.foodcartsite.com` is provisioned immediately.
- [x] Onboarding wizard collects business identity, slug, cuisine type, and links to existing presence (Google Business Profile, Yelp, DoorDash, UberEats, Grubhub, Instagram, Facebook, TikTok, existing website, menu URL) plus logo/hero image upload or fallback.
- [x] If an ingestion source fails, the user sees a clear manual fallback and can still complete onboarding.
- [x] User chooses one of three food-native templates: **Banh Mi Fusion** (bold/diagonal), **Real Indian Food** (warm/heritage), **Mis Abuelos** (family/Mexican warmth).
- [x] Generated site includes the required sections: hero, about/story, menu, locations/hours, catering, contact, social links, and order links.
- [x] Owner can preview the generated site on desktop and mobile before publishing.
- [x] Owner can publish/unpublish the site from the admin dashboard.
- [x] Published site is publicly visible at `slug.foodcartsite.com`; unknown slugs return 404.
- [x] Tenant isolation enforced: no user can read or mutate another tenant's data.
- [ ] Median time to publish < 10 minutes in task-based tests with 5+ pilot owners *(validation in Ring 1/2)*.
- [ ] 24-hour publish rate ≥ 60% of signups *(validation in Ring 1/2)*.
- [ ] Owner brand-match rating ≥ 70% "good or great" on a post-publish micro-survey *(validation in Ring 1/2)*.
- [ ] Mobile Core Web Vitals LCP < 2.5 s; no accessibility regressions *(monitoring in Ring 1/2)*.

#### Definition of Done (Specific)

- [x] Onboarding funnel events instrumented end-to-end.
- [x] Ingestion adapters include health metrics and graceful degradation.
- [x] Admin dashboard demo recorded for stakeholders.
- [x] Security/integration tests verify tenant isolation.
- [x] Content block schema validates against all three reference templates (SPIKE-003 gate).

---

### Bet 2 — Live Open/Closed + Hours Management

| Field | Detail |
|---|---|
| **Status** | **Released** — progressive rollout in progress; pilot validation ongoing |
| **Outcome** | Customers see accurate, real-time open status. |
| **Customer outcome** | Fewer wasted trips and angry reviews about wrong hours. |
| **Business outcome** | Higher site trust and CTA click rate. |
| **Evidence** | `DISCOVERY/INTERVIEW_SYNTHESIS.md` (wrong hours = top-3 pain) |
| **Appetite** | 3 weeks (calendar); ~3 engineer-weeks |
| **Sequence** | Weeks 3–5 (starts after content-block model from Bet 1 is stable) |
| **North Star link** | Customer CTA Click Rate; site trust |

#### Acceptance Criteria

- [x] Hours stored per location with timezone, weekly schedule, and special-hours overrides for the next 14 days.
- [x] Hours imported from Google Business Profile during onboarding (Bet 1) and owner-editable in admin.
- [x] Public site displays a live open/closed badge with helper text (e.g., "Opens today at 11am" or "Closed — opens Wed at 10am").
- [x] Badge is timezone-aware and does not cause layout shift or LCP regression.
- [x] Admin hours editor is mobile-optimized with day rows, open/closed toggles, and copy-across-days.
- [ ] Open/closed badge accuracy is 100% against owner-verified hours during pilot *(validation in Ring 1/2)*.
- [ ] Zero wrong-hours complaints in first 30 days of pilot *(validation in Ring 1/2)*.
- [x] Mobile hours update time < 60 seconds in task-based UX test.
- [ ] Customer CTA click rate is non-negative vs. baseline *(validation in Ring 1/2)*.

#### Definition of Done (Specific)

- [x] Status endpoint has unit tests for edge cases (holidays, DST, closing soon, overnight).
- [x] ISR/cache invalidation verified when hours change.
- [x] Metrics track status-badge impressions and admin edit frequency.

---

## Committed — Cycle 2 (Next)

*Cycle 2 capacity plan will be finalized during the end-of-Cycle-1 retrospective and review. Items below are ranked and pre-sized for that planning session.*

### 1. Feature Flag Cleanup (Debt)

| Field | Detail |
|---|---|
| **Status** | Committed — Cycle 2, Week 1 |
| **Outcome** | Cycle 1 GA features are permanently enabled; flag inventory stays healthy. |
| **Customer outcome** | No behavior change; faster page loads and reduced configuration drift. |
| **Business outcome** | Lower operational complexity; fewer paths to accidentally break a feature. |
| **Appetite** | ~0.5 engineer-weeks |
| **Sequencing** | First item in Cycle 2; must complete before new feature flags are added. |

#### Acceptance Criteria

- [ ] All flags tied to Cycle 1 GA capabilities (`onboarding-v1`, `live-hours-v1`) are removed or defaulted to `true`.
- [ ] Fewer than 20 active flags per service.
- [ ] Remaining flags (e.g., `ai-assistant-spike`) are documented with owner, default state, and removal date.
- [ ] No regression in onboarding or hours functionality in production after cleanup.
- [ ] Feature-flag runbook in `docs/RUNBOOKS/` updated.

#### Definition of Done

- PR merged with reviewed flag-removal plan.
- Smoke tests pass against production after deployment.
- Runbook updated.
- No new flag added without a removal ticket.

---

### 2. Photo-Driven Business Discovery

| Field | Detail |
|---|---|
| **Status** | Committed — Cycle 2, Weeks 1–4 |
| **Outcome** | Owners onboard by snapping a photo of their cart; the platform finds their business and pre-fills the site. |
| **Customer outcome** | Even faster time-to-publish with less hunting for links. |
| **Business outcome** | Higher activation and 24-hour publish rate; differentiation vs. URL-only builders. |
| **Evidence** | `docs/SHAPED_BETS.md` Bet 4; Cycle 1 onboarding drop-off at Links step; natural extension of ingestion strategy. |
| **Appetite** | 4 weeks (calendar); ~6 engineer-weeks |
| **Sequencing** | Starts after feature-flag cleanup; builds on Cycle 1 onboarding and ingestion frameworks. SPIKE-006 validates photo→name accuracy in week 1. |
| **North Star link** | Time to Publish < 10 min; 24-hour Publish Rate > 60% |

#### Acceptance Criteria

- [ ] New onboarding step supports file picker and camera capture.
- [ ] Images are compressed client-side and uploaded to Cloudflare R2 via presigned URL.
- [ ] Gemini multimodal adapter extracts business name, cuisine, visible text, and location hints from the photo.
- [ ] Google Places adapter enriches extracted name with address, phone, hours, website, and GBP URL.
- [ ] Yelp, menu, and ordering links are discovered from Places/website data via existing ingestion pipeline.
- [ ] Extracted data pre-populates the onboarding form as editable proposals.
- [ ] Uploaded photo is used as default hero image with owner toggle to skip/change.
- [ ] Feature is behind temporary flag `photo-onboarding-v1` with explicit removal ticket.
- [ ] SPIKE-006: ≥ 70% business-name accuracy on 20+ sample cart photos before full build commitment.

#### Definition of Done

- RFC 0005 and ADR 0008 merged.
- Backend test coverage ≥ 80%; contract and E2E tests added.
- `openapi.yaml` updated.
- Security review completed for upload path, EXIF handling, and PII.
- Staged rollout behind flag; metrics and SLOs instrumented.

---

### 3. AI Website Assistant Full Build

| Field | Detail |
|---|---|
| **Status** | Committed — Cycle 2 (pending spike hand-off from Cycle 1) |
| **Outcome** | Owners feel safe making natural-language edits. |
| **Customer outcome** | Menu, hours, and hero updates feel as easy as texting. |
| **Business outcome** | Differentiation, higher engagement, lower support burden. |
| **Evidence** | `DISCOVERY/INTERVIEW_NOTES/2026-06-24_jen_banhmi.md`, `DISCOVERY/ASSUMPTIONS.md` (#4), `docs/adr/0003-ai-assistant-harness.md` |
| **Appetite** | 6 weeks (calendar); ~10–12 engineer-weeks |
| **Sequencing** | Starts after flag cleanup; builds on Cycle 1 content-block model. |
| **North Star link** | WASE; AI Edit Adoption > 35% of active owners |

#### Acceptance Criteria

- [ ] SPIKE-001 (LLM provider benchmark) completed: cost/accuracy/latency comparison documented.
- [ ] SPIKE-004: > 90% of realistic owner prompts produce a valid `ChangePreview` object.
- [ ] SPIKE-005: 0 unauthorized actions across 50 adversarial/red-team prompts.
- [ ] Allowlisted operations documented and enforced: hero, menu, locations/hours, story, social/order links, catering blurb.
- [ ] Prohibited operations documented and enforced: account/billing/auth changes, slug/domain changes, cross-tenant access, code/SQL execution.
- [ ] Draft UI flow for prompt → diff preview → approve/reject reviewed by UX Researcher.
- [ ] Assistant creates a `Revision` snapshot before applying any change; one-click revert works in < 5 seconds.
- [ ] Median propose-to-apply latency < 2 minutes; p95 < 5 seconds backend.
- [ ] AI edit adoption ≥ 35% of active owners in first 30 days of GA.
- [ ] SUS / trust rating ≥ 70 in usability test with 5 owners.

#### Definition of Done

- Feature is behind a temporary flag (`ai-assistant-v1`) with explicit removal ticket.
- All allowlisted mutations have integration tests.
- Red-team test suite passes in CI.
- Audit log events flow to the analytics pipeline.
- `docs/adr/0003-ai-assistant-harness.md` updated if architecture changed.
- UX Researcher signs off on trust/usability demo.

---

### 4. Analytics Instrumentation & Owner Dashboard

| Field | Detail |
|---|---|
| **Status** | Committed — Cycle 2 |
| **Outcome** | Owners and the squad understand what drives engagement and orders. |
| **Customer outcome** | Owners see simple, actionable metrics about their site. |
| **Business outcome** | Data-informed prioritization; proof of ROI for future billing. |
| **Appetite** | ~3 engineer-weeks |
| **Sequencing** | Parallel with AI assistant build; depends on Cycle 1 event schema. |

#### Acceptance Criteria

- [ ] Event schema documents all required Cycle 1/2 events: signup, onboarding steps, publish, unpublish, hours edit, status-badge impression, CTA clicks, AI propose/approve/reject/revert.
- [ ] Events are emitted from frontend and backend and validated in staging.
- [ ] Owner dashboard shows: published status, 7-day site views, top CTA clicks, and hours-badge impressions.
- [ ] Squad-facing Grafana dashboard tracks WASE, 24-hour publish rate, CTA click rate, error rate, p95 latency, and LCP.
- [ ] Data Analyst validates data quality and dashboard accuracy.
- [ ] Privacy / PII handling follows `docs/THREAT_MODEL.md` and `docs/SECURITY_REVIEW.md`.

#### Definition of Done

- Analytics PRs merged and instrumented in production.
- Dashboards linked in `METRICS.md`.
- Data Analyst signs off.
- No PII leakage in events.

---

## Shaping Queue — Cycle 2 Candidates

These items have signals but require additional shaping or discovery before moving to Committed.

### 4. Billing & Custom Domains — Discovery/Shaping
- **Status:** Shaping — Cycle 2 candidate.
- **Outcome:** Clear monetization path and custom-domain shaped bet.
- **Business outcome:** Unlock MRR and higher willingness-to-pay.
- **Next step:** Run pricing-sensitivity survey with 10+ owners; shape custom-domain bet including DNS/SSL/edge-config feasibility.
- **Acceptance criteria for shaping:**
  - [ ] Pricing survey completed with ≥10 responses.
  - [ ] Willingness-to-pay threshold documented.
  - [ ] Custom-domain shaped bet with appetite, rabbit holes, and no-gos.
  - [ ] Stripe integration feasibility reviewed by Tech Lead.
  - [ ] Plan tiers (Free / Pro / Growth) straw-man reviewed with leadership.

### 5. Catering Lead Capture Flow
- **Status:** Shaping queue / next shaping target after AI assistant.
- **Outcome:** Catering inquiries captured with structured details instead of lost in DMs.
- **Business outcome:** Increase ARPU and justify Pro plan.
- **Next step:** Run 3 more interviews about catering workflow and willingness to pay.

### 6. Direct Order Links & Click-Share Analytics
- **Status:** Shaping queue.
- **Outcome:** Prominent, configurable direct order links and owner visibility into click share.
- **Business outcome:** Increase direct-order share ≥ 15% of order clicks within 90 days.
- **Next step:** Validate CTA copy preference and tracking approach with pilots.

---

## Observe & Improve Experiments

*Added during Cycle 1 Week 1 review. Each experiment is metric-driven, bounded, and has a clear ship/iterate/rollback decision.*

### EXP-002 — Onboarding Template Smart Default

| Field | Detail |
|---|---|
| **Status** | Planned — first post-launch experiment |
| **Hypothesis** | Pre-selecting a template based on cuisine type (or showing a single recommended default) will reduce decision friction and increase 24-hour publish rate by ≥ 10 percentage points vs. manual template selection. |
| **North Star link** | WASE via publish rate and time-to-publish |
| **Owner** | Data Analyst / Product |
| **Appetite** | 2 weeks |
| **Sequence** | Starts after Ring 2 GA, when baseline publish rate is stable |

#### Treatment arms

- **Control:** Current manual template grid (Banh Mi Fusion, Real Indian Food, Mis Abuelos).
- **Treatment A:** Cuisine-matched smart default with one-tap confirm/swap.
- **Treatment B:** Single recommended default + "Browse all" secondary action.

#### Metrics

| Metric | Baseline | Success criterion |
|---|---|---|
| 24-hour publish rate | Ring 2 baseline | ≥ +10 pp on treatment |
| Median time to publish | Ring 2 baseline | < 10 min; ≥ 15% improvement on treatment |
| Template swap rate | N/A | < 30% (indicates default is acceptable) |
| Owner brand-match rating | Ring 2 baseline | No regression (< 5 pp drop) |

#### Rollback triggers

- 24-hour publish rate drops > 5 pp vs. control.
- Brand-match rating drops > 10 pp.
- Any template-matching bug causes incorrect default assignment.

---

### EXP-003 — Hero CTA Order-Link Prominence

| Field | Detail |
|---|---|
| **Status** | Shaping queue — pending pilot CTA baseline |
| **Hypothesis** | Making the primary hero CTA a sticky "Order Online" button (vs. text link in hero) will increase customer CTA click rate by ≥ 3 pp without hurting brand-match rating. |
| **North Star link** | WASE via customer engagement; CTA click rate |
| **Owner** | Data Analyst / UX |
| **Appetite** | 1–2 weeks |
| **Sequence** | After EXP-002; requires ≥ 100 active published sites for power |

#### Treatment arms

- **Control:** Current hero text/link CTAs.
- **Treatment:** Sticky bottom-bar "Order Online" + top hero "View Menu / Order".

#### Metrics

| Metric | Baseline | Success criterion |
|---|---|---|
| Customer CTA click rate | Pre-experiment | ≥ +3 pp on treatment |
| Order-link click share | Pre-experiment | ≥ +5 pp direct order links |
| LCP | Pre-experiment | No regression > 100 ms |
| CLS | Pre-experiment | < 0.1 |

---

### EXP-004 — AI Assistant Prompt Placement

| Field | Detail |
|---|---|
| **Status** | Planned for Cycle 2 AI assistant GA |
| **Hypothesis** | Placing the AI assistant entry point on the dashboard home (not buried in a menu) will increase 30-day AI edit adoption from a projected 15% baseline to ≥ 35%. |
| **North Star link** | AI Edit Adoption; AI-assisted retention (+20 pp target) |
| **Owner** | Data Analyst / Product |
| **Appetite** | 2 weeks |
| **Sequence** | Coincides with AI Website Assistant full build (Cycle 2) |

#### Treatment arms

- **Control:** AI assistant in side-nav "Tools" menu.
- **Treatment:** Floating AI input bar on dashboard home + contextual "Suggest an update" chips.

#### Metrics

| Metric | Baseline | Success criterion |
|---|---|---|
| 30-day AI edit adoption | ≤ 15% (projected) | ≥ 35% on treatment |
| Median prompts per active user | N/A | ≥ 2 in first 7 days |
| Approval rate | N/A | ≥ 60% (signal of proposal quality) |
| Trust/SUS rating | N/A | ≥ 70 |

---

## Discovery Queue

These opportunities have signals but need more evidence before shaping.

| # | Opportunity | Signal | Next Step |
|---|---|---|---|
| 7 | Multi-Location Dashboard | 1 mini-chain owner described inconsistent hours/menu | Recruit 3 more multi-location owners; quantify update time |
| 8 | Version History / Revert Dashboard | Strong trust signal from interviews | Validate willingness to use with 5 pilot users (AI assistant may cover this) |
| 9 | Owner Analytics Dashboard | Usage signals from interviews | Define minimum useful metrics with owners (overlaps with Cycle 2 analytics item) |
| 10 | AI-Generated Social Posts | No direct customer evidence yet | Revisit after AI assistant adoption is proven |

---

## Icebox

| Opportunity | Reason Iceboxed |
|---|---|
| Native online ordering / checkout | Out of scope; competes with POS/delivery platforms and adds compliance burden. |
| Reservation system | Not a primary job for carts/counter-service; catering form covers near-term need. |
| Multi-language auto-translation | Valuable but unvalidated; requires extra design QA. |

---

## Prioritization Principles

1. No item moves to the Committed section without a shaped bet, feasibility review, and capacity check.
2. Each committed bet has a bounded appetite, explicit success metrics, and a clear sequencing plan.
3. Prefer bets that improve WASE (Weekly Active Site Engagement) and activation metrics.
4. Re-rank monthly based on discovery insights, cycle outcomes, and stakeholder input.
5. **Post-release rule:** flag cleanup is the first commitment of every new cycle; no new flags are added until the cleanup is complete.

---

## Decision Log

See `docs/STAKEHOLDER_DECISION_LOG.md` for the Cycle 1 deferred-bet decisions, release go/no-go criteria, and accepted risks.
