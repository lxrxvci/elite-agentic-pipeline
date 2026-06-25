# Opportunity Solution Tree — Foodcart SaaS

> **⚠️ Synthesized / hypothesis:** This OST is based on simulated discovery outputs. Every opportunity is tagged with evidence from the simulated interviews and synthesis. It must be revisited after real customer validation.

## North Star Outcome

> Food-cart and small-restaurant owners grow their business by converting more direct orders and capturing more catering leads with less digital overhead.
>
> **Measured by:** [Weekly Active Site Engagement (WASE)](../NORTH_STAR.md) — % of published tenant sites with ≥1 customer interaction or owner update in the last 7 days.

## Desired Business Outcomes

| ID | Outcome | Metric Hypothesis |
|---|---|---|
| BO-1 | Owners reduce time spent maintaining online presence | ≤ 5 min/week to keep site accurate |
| BO-2 | Owners increase direct order share | ≥ 15% of clicks to direct ordering links within 90 days |
| BO-3 | Owners capture more catering leads | ≥ 1 inquiry/site/month for catering-active tenants |
| BO-4 | Owners trust and actively use the platform | Weekly active edit rate ≥ 30% of sites |
| BO-5 | Platform achieves product/market fit | ≥ 40% of active users say "very disappointed" on Sean Ellis test |

---

## Outcomes → Opportunities → Solutions → Experiments

### Opportunity O1 — Auto-generate a credible site from existing links

**Hypothesis:** Operators have fragmented but sufficient digital assets to generate a first-pass website with minimal manual input.

| Field | Detail |
|---|---|
| **Evidence** | SIM-01, SIM-03, SIM-04; [INTERVIEW_SYNTHESIS.md](INTERVIEW_SYNTHESIS.md) T2, T9 |
| **Related Job Stories** | JS-01 |
| **Confidence** | Medium (synthesized) |

#### Solutions

| ID | Solution | Complexity | Feasibility Sniff |
|---|---|---|---|
| S1.1 | Ingest Google Business Profile, Yelp, DoorDash, UberEats, Grubhub, Instagram, Facebook, TikTok, menu URL, and logo/hero images to populate a single-page site. | Medium | Go — core value prop; use existing APIs/scrapers. |
| S1.2 | Auto-extract menu items, prices, and images from a menu URL/PDF. | High | Spike — menu extraction is notoriously noisy; start with structured import. |
| S1.3 | Onboarding wizard that asks 5 questions and previews the generated site before account creation. | Low | Go — reduces friction and sets expectations. |

#### Experiments

| ID | Experiment | Success Criteria | Owner |
|---|---|---|---|
| E1.1 | Audit 10 real food-cart digital profiles; measure data completeness. | ≥ 70% have enough data for a credible first pass. | UX Researcher |
| E1.2 | Build a concierge onboarding prototype with 3 pilot users. | ≤ 10 min from link input to preview; NPS ≥ 50. | Product Strategist |

---

### Opportunity O2 — Real-time hours/location sync and open/closed status

**Hypothesis:** Accurate live hours are a top trust signal and a driver of customer satisfaction.

| Field | Detail |
|---|---|
| **Evidence** | SIM-01, SIM-02, SIM-04; [INTERVIEW_SYNTHESIS.md](INTERVIEW_SYNTHESIS.md) T4 |
| **Related Job Stories** | JS-02 |
| **Confidence** | High (synthesized) |

#### Solutions

| ID | Solution | Complexity | Feasibility Sniff |
|---|---|---|---|
| S2.1 | Sync hours from Google Business Profile with one-way or bi-directional updates. | Low | Go — Google Business Profile API supports this. |
| S2.2 | Client-side open/closed status badge plus "opens next" time. | Low | Go — pure frontend logic; aligns with reference templates. |
| S2.3 | SMS/push alert to owner when hours look inconsistent across platforms. | Medium | Spike — high value but needs notification infra. |

#### Experiments

| ID | Experiment | Success Criteria | Owner |
|---|---|---|---|
| E2.1 | Compare generated hours against operator-verified hours in pilot. | 100% match after confirmation; zero customer "wrong hours" complaints. | Tech Lead |
| E2.2 | A/B test open/closed badge placement on generated sites. | Badge-click or bounce-rate improvement ≥ 10%. | UX Researcher |

---

### Opportunity O3 — Prominent, configurable direct order links

**Hypothesis:** Making direct order links visible and attractive increases direct-order share and owner margin.

| Field | Detail |
|---|---|
| **Evidence** | SIM-01, SIM-02; [INTERVIEW_SYNTHESIS.md](INTERVIEW_SYNTHESIS.md) T3 |
| **Related Job Stories** | JS-03 |
| **Confidence** | Medium (synthesized) |

#### Solutions

| ID | Solution | Complexity | Feasibility Sniff |
|---|---|---|---|
| S3.1 | Hero CTA + persistent "Order Online" button linked to operator's preferred direct ordering URL. | Low | Go — simple link mapping. |
| S3.2 | Menu cards with per-item order links to DoorDash/UberEats/direct. | Medium | Go — if menu extraction is solved. |
| S3.3 | Owner dashboard showing click-share by channel (direct vs. apps). | Low | Go — analytics table; high value for Kevin-like users. |

#### Experiments

| ID | Experiment | Success Criteria | Owner |
|---|---|---|---|
| E3.1 | Track direct vs. app link clicks for 5 pilot sites. | Direct-order click share ≥ 25% of total order clicks. | Product Owner |
| E3.2 | Interview operators on CTA copy preference ("Order Online" vs. "Order Direct"). | ≥ 3 of 5 prefer direct-order framing. | UX Researcher |

---

### Opportunity O4 — Fast, mobile-first menu editing

**Hypothesis:** Operators will keep their site fresh if they can update the menu from their phone in under a minute.

| Field | Detail |
|---|---|
| **Evidence** | SIM-01, SIM-03, SIM-04; [INTERVIEW_SYNTHESIS.md](INTERVIEW_SYNTHESIS.md) T1, T9 |
| **Related Job Stories** | JS-04 |
| **Confidence** | High (synthesized) |

#### Solutions

| ID | Solution | Complexity | Feasibility Sniff |
|---|---|---|---|
| S4.1 | Mobile-optimized menu editor with inline price/sold-out toggles. | Low | Go — core admin feature. |
| S4.2 | AI assistant command: "Add vegan section," "Mark tamales sold out," "Friday special $12." | Medium | Go — constrained structured output; clear guardrails. |
| S4.3 | Daily-special module separate from full menu. | Low | Go — addresses Jordan's use case. |

#### Experiments

| ID | Experiment | Success Criteria | Owner |
|---|---|---|---|
| E4.1 | Task-based test: update a menu price via AI vs. manual editor. | AI path ≤ 50% time of manual path; error rate < 5%. | UX Researcher |
| E4.2 | Pilot daily-special feature with 3 bakery/cafe owners. | Feature used ≥ 3 times/week per site. | Product Owner |

---

### Opportunity O5 — Dedicated catering section and inquiry form

**Hypothesis:** Catering is a high-margin, poorly supported workflow that can be captured with a structured section and form.

| Field | Detail |
|---|---|
| **Evidence** | SIM-01, SIM-03; [INTERVIEW_SYNTHESIS.md](INTERVIEW_SYNTHESIS.md) T8 |
| **Related Job Stories** | JS-05 |
| **Confidence** | Medium (synthesized) |

#### Solutions

| ID | Solution | Complexity | Feasibility Sniff |
|---|---|---|---|
| S5.1 | Catering section with package summary, photos, and structured inquiry form. | Low | Go — static section + form. |
| S5.2 | Owner inbox for catering inquiries with status tracking. | Medium | Go — simple CRM; high value. |
| S5.3 | Auto-reply with catering FAQ/package PDF upon inquiry submission. | Low | Go — reduces back-and-forth. |

#### Experiments

| ID | Experiment | Success Criteria | Owner |
|---|---|---|---|
| E5.1 | Add catering form to 3 pilot sites; measure inquiry volume. | ≥ 1 inquiry/site in 30 days. | Product Owner |
| E5.2 | Interview 5 catering-active operators on required form fields. | ≥ 4 of 5 confirm date/headcount/dietary/budget are essential. | UX Researcher |

---

### Opportunity O6 — Opinionated templates + brand customization

**Hypothesis:** Operators reject generic templates; they need a starting point that matches their brand vibe plus easy customization.

| Field | Detail |
|---|---|
| **Evidence** | SIM-01, SIM-02, SIM-03, SIM-04; [INTERVIEW_SYNTHESIS.md](INTERVIEW_SYNTHESIS.md) T7 |
| **Related Job Stories** | JS-06 |
| **Confidence** | High (synthesized) |

#### Solutions

| ID | Solution | Complexity | Feasibility Sniff |
|---|---|---|---|
| S6.1 | 3 launch templates: Bold/Diagonal (Banh Mi Fusion), Warm/Heritage (Real Indian Food), Family/Warm (Mis Abuelos). | Medium | Go — core design deliverable. |
| S6.2 | Color, font, and hero-image customization without code. | Low | Go — token-based theming. |
| S6.3 | Template quiz: "Pick the vibe that matches your cart." | Low | Go — improves onboarding match. |

#### Experiments

| ID | Experiment | Success Criteria | Owner |
|---|---|---|---|
| E6.1 | Preference test of 3 templates with 10 operators. | ≥ 60% select a template that matches their self-described vibe. | UX Researcher |
| E6.2 | Measure customization usage in pilot. | ≥ 50% of owners customize color or hero image within first week. | Product Owner |

---

### Opportunity O7 — Harnessed AI Website Assistant with preview/approval

**Hypothesis:** A constrained AI assistant can reduce update friction while maintaining operator trust through preview/approval.

| Field | Detail |
|---|---|
| **Evidence** | SIM-02, SIM-03, SIM-04; [INTERVIEW_SYNTHESIS.md](INTERVIEW_SYNTHESIS.md) T6 |
| **Related Job Stories** | JS-07 |
| **Confidence** | Medium (synthesized) |

#### Solutions

| ID | Solution | Complexity | Feasibility Sniff |
|---|---|---|---|
| S7.1 | Natural-language edit with structured diff preview and explicit approve/reject. | Medium | Go — LLM structured output + guardrails. |
| S7.2 | Scope restrictions: AI cannot delete account, change billing, modify auth, access other tenants, or run code. | Low | Go — permission layer. |
| S7.3 | Version history and one-click revert for all AI and manual changes. | Medium | Go — database versioning. |

#### Experiments

| ID | Experiment | Success Criteria | Owner |
|---|---|---|---|
| E7.1 | Usability test of AI edit flow with 5 operators. | ≥ 80% approve AI suggestions without rework; SUS ≥ 70. | UX Researcher |
| E7.2 | Pilot guardrails with red-team prompts. | 0 unauthorized actions across 50 adversarial prompts. | Tech Lead |

---

### Opportunity O8 — Per-location pages and menus

**Hypothesis:** Multi-location operators need location-aware sites to avoid wrong orders.

| Field | Detail |
|---|---|
| **Evidence** | SIM-02; [JOB_STORIES.md](JOB_STORIES.md) JS-08 |
| **Related Job Stories** | JS-08 |
| **Confidence** | Low (synthesized) |

#### Solutions

| ID | Solution | Complexity | Feasibility Sniff |
|---|---|---|---|
| S8.1 | Location selector/pill on single-page site. | Low | Go — UI change. |
| S8.2 | Per-location hours, address, phone, and menu overrides. | Medium | Spike — data model changes. |

#### Experiments

| ID | Experiment | Success Criteria | Owner |
|---|---|---|---|
| E8.1 | Interview 5 multi-location operators. | ≥ 3 confirm wrong-location orders are a real problem. | UX Researcher |

---

### Opportunity O9 — Versioned, revertible changes

**Hypothesis:** Operators will trust the platform more if they know any mistake can be undone instantly.

| Field | Detail |
|---|---|
| **Evidence** | SIM-03; [INTERVIEW_SYNTHESIS.md](INTERVIEW_SYNTHESIS.md) T6 |
| **Related Job Stories** | JS-09 |
| **Confidence** | Medium (synthesized) |

#### Solutions

| ID | Solution | Complexity | Feasibility Sniff |
|---|---|---|---|
| S9.1 | Store versioned snapshots of site content; one-click revert in admin. | Medium | Go — audit table + publish rollback. |
| S9.2 | Show recent changes dashboard with who/what/when. | Low | Go — builds transparency. |

#### Experiments

| ID | Experiment | Success Criteria | Owner |
|---|---|---|---|
| E9.1 | Revert simulation with pilot users. | Revert action completes in < 2 seconds; user success rate 100%. | Tech Lead |

---

### Opportunity O10 — Owner analytics dashboard

**Hypothesis:** Operators want visibility into what customers do on their site to guide marketing decisions.

| Field | Detail |
|---|---|
| **Evidence** | SIM-02, SIM-04; [JOB_STORIES.md](JOB_STORIES.md) JS-10 |
| **Related Job Stories** | JS-10 |
| **Confidence** | Medium (synthesized) |

#### Solutions

| ID | Solution | Complexity | Feasibility Sniff |
|---|---|---|---|
| S10.1 | Dashboard: views, menu clicks, order-link clicks, catering inquiries. | Low | Go — aggregate events. |
| S10.2 | Weekly email summary of site activity. | Low | Go — retention hook. |

#### Experiments

| ID | Experiment | Success Criteria | Owner |
|---|---|---|---|
| E10.1 | Add analytics dashboard to pilot; survey owners. | ≥ 60% find data useful; ≥ 30% check weekly. | UX Researcher |

---

## Prioritization for Shaping

| Priority | Opportunities | Rationale |
|---|---|---|
| **P0 — Shape next** | O1, O2, O6, O7 | Core MVP value: generate a site fast, keep it accurate, look authentic, edit safely with AI. |
| **P1 — Near-term backlog** | O3, O4, O5, O9 | Revenue and retention drivers; build trust and monetization. |
| **P2 — Future backlog** | O10, O8 | Segment-specific features; validate with real demand before committing. |

## Evidence Traceability

| Evidence ID | Source | Opportunities Influenced |
|---|---|---|
| BASE-01 | [INTERVIEW_NOTES/2026-06-24_maria_tacos.md](INTERVIEW_NOTES/2026-06-24_maria_tacos.md) | O1, O2, O4, O5, O6 |
| BASE-02 | [INTERVIEW_NOTES/2026-06-24_jen_banhmi.md](INTERVIEW_NOTES/2026-06-24_jen_banhmi.md) | O1, O2, O3, O6, O7, O8 |
| BASE-03 | [INTERVIEW_NOTES/2026-06-24_raj_curry.md](INTERVIEW_NOTES/2026-06-24_raj_curry.md) | O1, O2, O3, O5, O6, O7 |
| BASE-04 | [INTERVIEW_NOTES/2026-06-24_diego_barbacoa.md](INTERVIEW_NOTES/2026-06-24_diego_barbacoa.md) | O1, O2, O5, O6 |
| BASE-05 | [INTERVIEW_NOTES/2026-06-24_sam_pizza.md](INTERVIEW_NOTES/2026-06-24_sam_pizza.md) | O1, O3, O10 |
| SIM-01 | [INTERVIEW_NOTES/maria-santos.md](INTERVIEW_NOTES/maria-santos.md) | O1, O2, O4, O5, O6 |
| SIM-02 | [INTERVIEW_NOTES/kevin-nguyen.md](INTERVIEW_NOTES/kevin-nguyen.md) | O1, O2, O3, O6, O7, O8, O10 |
| SIM-03 | [INTERVIEW_NOTES/priya-patel.md](INTERVIEW_NOTES/priya-patel.md) | O1, O4, O5, O6, O7, O9 |
| SIM-04 | [INTERVIEW_NOTES/jordan-blake.md](INTERVIEW_NOTES/jordan-blake.md) | O1, O2, O3, O4, O6, O10 |
| T1–T9 | [INTERVIEW_SYNTHESIS.md](INTERVIEW_SYNTHESIS.md) | All opportunities |
| JS-01–JS-10 | [JOB_STORIES.md](JOB_STORIES.md) | All opportunities |

---

## Cycle 1 Learnings — New Experiments (Observe & Improve)

*Added during the Observe & Improve stage after the Cycle 1 build and first weekly review. These experiments are tracked in `BACKLOG.md` and inform Cycle 2 shaping.*

| Experiment ID | Linked Opportunity | Problem / Signal | Hypothesis | Success Metric | Owner |
|---|---|---|---|---|---|
| **EXP-001** | O6 — Opinionated templates + brand customization | Manual template selection creates decision fatigue (`METRICS.md` bottleneck #2). | A smart default or vibe quiz reduces onboarding time and improves match. | Median time to publish ↓20%; 24h publish rate ≥65%; brand-match rating ≥70%. | Product Strategist + UX Researcher |
| **EXP-002** | O1 — Auto-generate a credible site | Unoptimized images risk LCP regressions (`METRICS.md`). | Next.js Image / R2 transforms improve speed and CTA clicks. | Mobile LCP <2.0s; CTA click rate ≥8%. | Frontend Engineer + UX |
| **EXP-003** | O1 — Auto-generate a credible site | Owners abandon onboarding when interrupted during shifts. | Progress saver + resume nudge increases completion. | +10 pp 24h publish rate; drop-off at template/preview step ↓30%. | Product Strategist + Frontend |
| **EXP-004** | O7 — Harnessed AI Website Assistant | Owners fear breaking the site (interview synthesis T6/T9). | Visible guardrails + diff preview + revert increase trust and adoption. | AI edit adoption ≥35%; proposal acceptance ≥80%; SUS ≥70. | Product Strategist + UX Researcher |
| **EXP-005** | O2 — Real-time hours/location sync | Wrong hours are a top-3 pain (interview synthesis T4). | Post-publish hours verification nudge eliminates complaints. | 0 wrong-hours complaints in 30 days; badge accuracy 100%. | Product Strategist + UX |

These experiments are intentionally small and de-risked. Any experiment that hits its expected outcome will be shaped into a Cycle 2 or Cycle 3 bet; any that misses will be revised or dropped after a short problem interview.

---

## Cycle 1 Implementation Evidence & New Opportunities

*Added during Observe & Improve after Cycle 1 release. These opportunities are grounded in the shipped build, current metrics, and known bottlenecks.*

### New Opportunities

#### Opportunity O11 — Smart Template Defaults / Onboarding Quiz

**Hypothesis:** Manual template selection creates decision fatigue; a short vibe quiz or cuisine-based smart default can speed up onboarding and improve brand-match.

| Field | Detail |
|---|---|
| **Evidence** | [METRICS.md](../METRICS.md) Cycle 1 Week 1 bottleneck "Template selection friction"; [BACKLOG.md](../BACKLOG.md) EXP-002 queued |
| **Related Job Stories** | JS-06 |
| **Confidence** | Low (implementation signal, no user data) |

**Solutions**

| ID | Solution | Complexity | Feasibility Sniff |
|---|---|---|---|
| S11.1 | "Pick your vibe" 3-question quiz at onboarding that recommends a default template. | Low | Go |
| S11.2 | Cuisine-to-template smart default with one-tap override. | Low | Go |
| S11.3 | A/B test quiz/default against manual selection. | Low | Go |

**Experiments**

| ID | Experiment | Success Criteria | Owner |
|---|---|---|---|
| E11.1 | A/B quiz/default vs manual template selection. | Time-to-publish improves ≥ 15%; brand-match rating non-inferior. | UX Researcher |
| E11.2 | Interview 5 owners on quiz transparency. | ≥ 4 of 5 feel the suggested template matches their brand. | UX Researcher |

---

#### Opportunity O12 — Ingestion Fallback & Partial-Data Onboarding

**Hypothesis:** When API ingestion fails or returns partial data, owners still complete onboarding if the fallback path is fast, clear, and mobile-friendly.

| Field | Detail |
|---|---|
| **Evidence** | [BACKLOG.md](../BACKLOG.md) Bet 1 acceptance criterion on manual fallback; [docs/adr/0007-external-platform-ingestion-strategy.md](../docs/adr/0007-external-platform-ingestion-strategy.md); [METRICS.md](../METRICS.md) onboarding completion TBD |
| **Related Job Stories** | JS-01 |
| **Confidence** | Medium |

**Solutions**

| ID | Solution | Complexity | Feasibility Sniff |
|---|---|---|---|
| S12.1 | Inline "We couldn't read this link — paste or type the info" fallback with smart defaults. | Low | Go |
| S12.2 | Partial preview: show what *was* imported and let the owner fill gaps before publish. | Medium | Go |
| S12.3 | Concierge import: owner submits links and support completes onboarding within 24 h. | Medium | Spike |

**Experiments**

| ID | Experiment | Success Criteria | Owner |
|---|---|---|---|
| E12.1 | Measure fallback usage and completion rate in Ring 0. | ≥ 80% of fallback users publish; completion rate within 5 pp of non-fallback. | Product Owner |
| E12.2 | Think-aloud test of fallback UX with 3 owners. | 0 critical confusion points; all complete without moderator takeover. | UX Researcher |

---

#### Opportunity O13 — AI Assistant Comprehension & Trust

**Hypothesis:** A clear diff preview and visible revert path are the primary trust builders for non-technical owners using the AI assistant.

| Field | Detail |
|---|---|
| **Evidence** | [docs/adr/0003-ai-assistant-harness.md](../docs/adr/0003-ai-assistant-harness.md); [INTERVIEW_SYNTHESIS.md](INTERVIEW_SYNTHESIS.md) T6; [BACKLOG.md](../BACKLOG.md) AI Website Assistant Full Build |
| **Related Job Stories** | JS-07 |
| **Confidence** | Medium |

**Solutions**

| ID | Solution | Complexity | Feasibility Sniff |
|---|---|---|---|
| S13.1 | Before/after diff cards with plain-language change summaries. | Low | Go |
| S13.2 | Inline "Why did the AI suggest this?" explanation for non-obvious changes. | Medium | Spike |
| S13.3 | Persistent "Last AI change — revert" banner on dashboard. | Low | Go |

**Experiments**

| ID | Experiment | Success Criteria | Owner |
|---|---|---|---|
| E13.1 | Usability test of AI edit flow with 5 owners. | ≥ 80% approve without rework; SUS ≥ 70; trust rating ≥ 70. | UX Researcher |
| E13.2 | Red-team / adversarial prompt test. | 0 unauthorized actions across 50 prompts. | Tech Lead |

---

#### Opportunity O14 — Post-Publish Engagement Loop

**Hypothesis:** Owners churn if they don't see value after publishing; lightweight nudges and quick wins increase return visits and updates.

| Field | Detail |
|---|---|
| **Evidence** | [METRICS.md](../METRICS.md) WASE target TBD; [INTERVIEW_SYNTHESIS.md](INTERVIEW_SYNTHESIS.md) time-poverty theme T1 |
| **Related Job Stories** | JS-02, JS-04, JS-10 |
| **Confidence** | Low |

**Solutions**

| ID | Solution | Complexity | Feasibility Sniff |
|---|---|---|---|
| S14.1 | Weekly "Your site this week" email summary: views, clicks, top CTA. | Low | Go |
| S14.2 | Dashboard "One-tap updates" suggestions (e.g., holiday hours, weekend special). | Medium | Spike |
| S14.3 | Celebration moment after first customer CTA click. | Low | Go |

**Experiments**

| ID | Experiment | Success Criteria | Owner |
|---|---|---|---|
| E14.1 | Pilot weekly email with 10 owners. | ≥ 40% open rate; ≥ 20% click-through to dashboard. | Product Strategist |
| E14.2 | Cohort retention: owners with ≥1 weekly update vs none. | Update cohort shows +10 pp 30-day retention. | Data Analyst |

---

#### Opportunity O15 — Core Web Vitals / Image Performance

**Hypothesis:** Unoptimized images and layout-shift risks observed in Cycle 1 will hurt real-world LCP and conversion if not fixed before scale.

| Field | Detail |
|---|---|
| **Evidence** | [METRICS.md](../METRICS.md) frontend lint warnings for `<img>` tags; LCP target < 2.5 s |
| **Related Job Stories** | JS-01 |
| **Confidence** | Medium |

**Solutions**

| ID | Solution | Complexity | Feasibility Sniff |
|---|---|---|---|
| S15.1 | Replace unoptimized `<img>` tags with Next.js `<Image>` and sizing. | Low | Go |
| S15.2 | Lazy-load below-the-fold menu images. | Low | Go |
| S15.3 | CDN image resizing per template breakpoint. | Medium | Go |

**Experiments**

| ID | Experiment | Success Criteria | Owner |
|---|---|---|---|
| E15.1 | Field CWV audit after 50 published tenants. | p75 LCP < 2.5 s; CLS < 0.1. | Tech Lead |
| E15.2 | A/B optimized images vs baseline on one template. | LCP improvement ≥ 20%; CTA click rate non-negative. | UX Researcher |

### Updated Evidence Traceability

The following Cycle 1 implementation artifacts now back existing opportunities:

| Opportunity | New Implementation Evidence |
|---|---|
| O1 | [BACKLOG.md](../BACKLOG.md) Bet 1 — 10-Minute Publish Onboarding; [docs/adr/0007-external-platform-ingestion-strategy.md](../docs/adr/0007-external-platform-ingestion-strategy.md) |
| O2 | [BACKLOG.md](../BACKLOG.md) Bet 2 — Live Open/Closed + Hours Management |
| O4 | [BACKLOG.md](../BACKLOG.md) Bet 1 mobile menu editing; [docs/adr/0006-content-block-schema-template-engine.md](../docs/adr/0006-content-block-schema-template-engine.md) |
| O6 | [BACKLOG.md](../BACKLOG.md) Bet 1 template acceptance; [design/DESIGN_SPECS.md](../design/DESIGN_SPECS.md) |
| O7 | [docs/adr/0003-ai-assistant-harness.md](../docs/adr/0003-ai-assistant-harness.md); [BACKLOG.md](../BACKLOG.md) AI Website Assistant Full Build |
| O9 | [BACKLOG.md](../BACKLOG.md) Bet 1 publish/unpublish + revision snapshot |
| O10 | [BACKLOG.md](../BACKLOG.md) Cycle 2 analytics instrumentation |

*Note: As live telemetry arrives, replace implementation evidence with observed behavioral evidence and update confidence levels.*
