# Shaped Bets — Foodcart SaaS (Cycle 1)

> Stage: shaping  
> Shaped by: Product Strategist  
> Date: 2026-06-24  
> Inputs: `BRIEF.md`, `DISCOVERY/OST.md`, `DISCOVERY/INTERVIEW_SYNTHESIS.md`, `ROADMAP.md`, `BACKLOG.md`, `PRODUCT_STRATEGY.md`, `PMF_REPORT.md`, `docs/adr/0003-ai-assistant-harness.md`

---

## How to Read This Document

Each bet below is a **rough-but-bounded solution** for the first build cycle (Cycle 1). It is concrete enough to evaluate and resource, but leaves detailed UX, API, and implementation decisions to the product trio during the build.

The **betting recommendation** at the end states which bets to build now, spike, or defer.

---

## Bet 1 — 10-Minute Publish Onboarding

### Problem

Food-cart and small-restaurant owners need to look credible online, but they have no website or an abandoned one. Existing builders start from a blank page and require design decisions, copywriting, and hours of setup they do not have. Interview synthesis shows **8/9 owners cite time/skill to maintain a site** as a high-severity pain, and **7/9 have no website or an outdated one** ([INTERVIEW_SYNTHESIS.md](../DISCOVERY/INTERVIEW_SYNTHESIS.md)). The core wedge of Foodcart SaaS is turning the digital breadcrumbs owners already have — Google Business Profile, Yelp, delivery platforms, social links — into a polished, mobile-first site before their next shift.

### Appetite

**6 weeks.** We are willing to spend one full cycle to make the first-publish experience the strongest acquisition and activation hook.

### Solution Sketch

A five-step onboarding flow that generates a complete single-page site:

1. **Business identity** — name, desired slug (reserved immediately), cuisine type.
2. **Connect existing presence** — Google Business Profile OAuth/connect (primary), with manual fallback for Yelp, DoorDash, UberEats, Grubhub, Instagram, Facebook, TikTok, existing website, and menu URL.
3. **Brand assets** — upload or select logo and hero images; fallback to a food-themed placeholder set.
4. **Template match** — choose one of three food-native templates:
   - **Banh Mi Fusion** — bold diagonal energy, menu carousel, locations, catering.
   - **Real Indian Food** — warm heritage storytelling, menu, catering.
   - **Mis Abuelos** — family/Mexican warmth.
5. **Preview & publish** — show the generated site on desktop and mobile, allow quick edits to headline/hours/menu, then one-click publish to `slug.foodcartsite.com`.

The generated site includes the sections defined in the brief: hero, about/story, menu, locations/hours with live open/closed status, catering, contact, social links, and order links.

The admin dashboard (mobile-first) lets owners edit business info, preview draft changes, and toggle publish state.

### Rabbit Holes

- **Full menu extraction from PDFs or images.** Start with structured manual entry or a simple paste-to-menu parser. Deep PDF/image extraction is a separate spike.
- **Bi-directional sync with Google Business Profile.** One-way import during onboarding only; updates happen in the Foodcart dashboard.
- **Multi-location support.** Single location per site in this bet.
- **Custom domains and DNS.** Deferred to a later cycle.
- **Rich animation that hurts Core Web Vitals.** Motion should be progressive; LCP is a success criterion.

### No-Gos

- No subscription billing or plan enforcement.
- No custom domains.
- No AI assistant (separate bet).
- No multi-location or per-location menus.
- No native checkout / online ordering — only external order links.
- No social-post generation or reservation booking.

### Success Criteria

| Metric | Target | How Measured |
|---|---|---|
| Median time to publish | < 10 min | Task-based onboarding tests with 5 pilot owners |
| 24-hour publish rate | ≥ 60% | Signup funnel analytics |
| Owner brand-match rating | ≥ 70% "good or great" | Post-publish micro-survey |
| Mobile Core Web Vitals LCP | < 2.5 s | Chrome UX Report / Vercel |
| Generated section completeness | ≥ 6 of 7 required sections present | Automated audit on publish |

### Technical Feasibility Note (Tech Lead)

| Dimension | Assessment |
|---|---|
| **Risks** | R2 ingestion fragility; R11 slug-reservation race conditions / collisions; R14 misleading first-pass content eroding trust; R6 image storage costs/latency; R10 future billing stubs. |
| **Dependencies** | Google Business Profile / Places API credentials and quota; Yelp Fusion API; Redis job queue; object store (R2/S3) for logos/heroes; Clerk webhook for user provisioning; content block schema validated for all three templates. |
| **Unknowns** | Real-world data completeness of GBP listings for mobile food carts; whether menu URLs are structured HTML or PDFs; actual API rate limits under pilot load; owner tolerance for manual fallback. |
| **Spike needs** | **SPIKE-002** (ingestion feasibility) must complete before build starts. **SPIKE-003** (content block schema) must prove all three reference templates render correctly from generated blocks. |
| **Recommendation** | **BUILD** — core MVP value. Keep ingestion narrow: GBP + manual fallback first, Yelp second, menu URL third. Commit only after SPIKE-002 demonstrates ≥ 70% credible first-pass data quality. |

---

## Bet 2 — Live Open/Closed + Hours Management

### Problem

Stale hours and wrong locations are a top trust-killer. **6/9 interviewed owners** reported wrong hours confusing customers, and rotating-location carts lose business when the site does not match reality ([INTERVIEW_SYNTHESIS.md](../DISCOVERY/INTERVIEW_SYNTHESIS.md)). A generated site that looks beautiful but tells customers the cart is open when it is closed will be abandoned.

### Appetite

**3 weeks.** This bet can run largely in parallel with Bet 1 and should be scoped as a quick win.

### Solution Sketch

- **Hours editor** in the admin dashboard, optimized for mobile: tap-friendly day rows, open/closed toggles, special-hours overrides.
- **Onboarding import** of hours from Google Business Profile during Bet 1 flow.
- **Client-side open/closed badge** on the public site, timezone-aware, with helper text such as "Opens today at 11am" or "Closed — opens Wed at 10am."
- **Location block** with address, phone, map link, and optional "find us" note for rotating pods.
- **Holiday / special-hours override** for the next 14 days.

### Rabbit Holes

- **Bi-directional sync back to Google Business Profile.** Out of scope; we read, not write.
- **Complex recurring holiday rules.** Only ad-hoc special hours for the next 14 days.
- **GPS-based location auto-update.** Manual location entry only.
- **Weather-based closure automation.** Manual toggle only.

### No-Gos

- No SMS/push alerts when hours look inconsistent.
- No automatic weather or event-based closures.
- No multi-location location selector.
- No integration with POS systems for real-time open status.

### Success Criteria

| Metric | Target | How Measured |
|---|---|---|
| Open/closed badge accuracy | 100% against owner-verified hours | Pilot verification |
| Wrong-hours complaints | 0 in first 30 days of pilot | Support / owner check-in |
| Mobile hours update time | < 60 seconds | Task-based test |
| Customer CTA click rate | Non-negative vs. baseline | Public site analytics |

### Technical Feasibility Note (Tech Lead)

| Dimension | Assessment |
|---|---|
| **Risks** | R12 timezone / DST errors in status calculation; stale cached public pages showing wrong status; split-shift or overnight edge cases. |
| **Dependencies** | IANA timezone support via `zoneinfo`/`pytz`; browser `Intl.DateTimeFormat`; content block schema for `locations`; ISR/cache invalidation when hours change. |
| **Unknowns** | Whether food carts have consistent IANA timezone coverage; how often owners update hours; whether GBP special/exception hours import cleanly. |
| **Spike needs** | None beyond **SPIKE-003** (schema validation). Timezone logic is well-understood and low-risk. |
| **Recommendation** | **BUILD** — quick win, high trust impact, low technical risk. Ship after the onboarding foundation is in place. |

---

## Bet 3 — AI Website Assistant with Guardrails

### Problem

Owners want to update their site as quickly as they post an Instagram Story, but current builders force them through slow editors. At the same time, **6/9 owners** expressed fear of "breaking something" with AI, and several said they would only use AI if changes were previewed and reversible ([INTERVIEW_SYNTHESIS.md](../DISCOVERY/INTERVIEW_SYNTHESIS.md)). The opportunity is a conversational assistant that proposes structured changes and applies nothing without explicit approval.

### Appetite

**6 weeks, but only after a 1-week spike.** We will commit the build weeks if the spike demonstrates that the harness can produce valid, safe change previews for realistic owner prompts.

### Solution Sketch

A chat-style input in the admin dashboard where owners type requests such as:

- "Add a vegan section to the menu."
- "Change the hero headline to Summer Specials."
- "Update Friday hours to 11pm."

The assistant:

1. Returns a structured `ChangePreview` (human-readable summary + before/after diff + confidence score).
2. Shows the diff in the UI.
3. Applies changes only after the owner taps **Approve**.
4. Creates a `Revision` snapshot before applying, enabling one-click revert.

**Allowlisted operations:** hero text/image/CTA, menu categories/items, location hours/address/phone, story text, social/order links, catering blurb.

**Prohibited operations:** account deletion/modification, billing/subscription changes, auth settings, site slug changes, cross-tenant access, arbitrary code/SQL execution.

Safety controls follow [ADR 0003](../adr/0003-ai-assistant-harness.md): input limits, system-prompt hardening, Pydantic schema validation, patch-path allowlist, per-tenant rate limits, audit logging, and circuit breaker on high error rates.

### Rabbit Holes

- **Open-ended creative generation** (e.g., "write my whole story in a poetic tone"). Scope to structured edits only.
- **Multi-turn conversational agent.** Single prompt → single preview in this bet.
- **Auto-apply for "low-risk" changes.** Every mutation requires explicit approval.
- **Menu extraction from unstructured sources.** Use existing menu structure from Bet 1.
- **Image generation or manipulation.** Out of scope.

### No-Gos

- No auto-apply without explicit owner approval.
- No account, billing, auth, or Clerk setting changes.
- No cross-tenant queries or mutations.
- No code, SQL, or shell execution.
- No image generation or AI-generated social posts.
- No changes to site slug or custom domain settings.

### Success Criteria

| Metric | Target | How Measured |
|---|---|---|
| AI suggestion acceptance | ≥ 80% approved without rework | AI event log + pilot interviews |
| Guardrail red-team | 0 unauthorized actions across 50 adversarial prompts | Security test |
| AI edit adoption | ≥ 35% of active owners use AI in first 30 days | AI event log |
| Median propose-to-apply time | < 2 minutes | Backend + frontend telemetry |
| Revert success rate | 100% | Automated regression test |
| SUS / trust rating | ≥ 70 | UX usability test with 5 owners |

### Technical Feasibility Note (Tech Lead)

| Dimension | Assessment |
|---|---|
| **Risks** | R1 LLM produces incorrect menu/items/hours; R7 prompt injection / adversarial use; R8 LLM call latency / serverless timeouts; R13 owners reject proposals because scope feels narrow or diff is unclear; R9 template rendering drift from changed blocks. |
| **Dependencies** | OpenAI / Anthropic structured-output API; Pydantic v2 schemas; Redis rate-limiting / tenant quotas; Revision and Content contexts already defined in ADR 0002; audit logging and observability. |
| **Unknowns** | Best LLM for cost/accuracy trade-off on menu/hours extraction; real-world prompt diversity; adversarial prompt surface area; owner accept vs. reject rates. |
| **Spike needs** | **SPIKE-001** (LLM provider benchmark), **SPIKE-004** (change-preview accuracy > 90%), and **SPIKE-005** (prompt-injection red-team) must all complete before committing to build. |
| **Recommendation** | **SPIKE first, then BUILD.** The harness architecture in ADR 0003 is sound, but cost, latency, and accuracy are unproven. Run the three spikes in parallel with Bet 1 groundwork; if they hit targets, build immediately after onboarding ships. |

---

## Betting Table — Cycle 1 Recommendation

| Bet | Appetite | Decision | Rationale |
|---|---|---|---|
| **Bet 1 — 10-Minute Publish Onboarding** | 6 weeks | **Build now** | Core MVP value. Blocks every downstream feature. Highest evidence: need + speed + brand authenticity are top jobs/pains. |
| **Bet 2 — Live Open/Closed + Hours** | 3 weeks | **Build now** | High-confidence quick win. Runs in parallel with Bet 1. Directly addresses a top-3 pain and a must-have for restaurants. |
| **Bet 3 — AI Website Assistant** | 1-week spike + 6-week build if spike passes | **Spike first, then build** | High differentiator and retention driver, but depends on LLM accuracy and safety. Tech Lead spikes SPIKE-004 and SPIKE-005; if schema-conformance > 90% and 0 guardrail breaches, commit the 6-week build in Cycle 1 or Cycle 2. |

### What We Are Explicitly Deferring

| Opportunity | Decision | Rationale |
|---|---|---|
| Catering lead capture | **Defer** | Strong signal but needs 3 more catering-specific interviews and Pro-tier pricing validation. |
| Multi-location dashboard | **Defer** | Only 1 mini-chain signal so far; validate with 2–3 more before shaping. |
| Custom domains | **Defer** | Future monetization bet; no validated demand yet. |
| Subscription billing | **Defer** | Business-viability bet, not a customer activation driver. |
| Advanced analytics | **Defer** | Nice-to-have; no validated willingness-to-pay. |
| Native checkout / social posts / reservations | **Pass / icebox** | Out of scope per roadmap and strategy. |

### Recommended Cycle 1 Scope

Build **Bet 1 and Bet 2 in parallel** (6 weeks total, with Bet 2 finishing early). Run the **AI assistant spike in weeks 1–2** and decide by the end of week 2 whether to fold Bet 3 into Cycle 1 or start it in Cycle 2.

This keeps the first cycle de-risked, delivers the core value proposition, and validates the biggest technical uncertainty (AI harness) before committing full engineering capacity.

---

## Evidence Traceability

| Bet | Primary OST Opportunities | Evidence |
|---|---|---|
| Bet 1 | O1 — Auto-generate site from existing links; O6 — Opinionated templates | [INTERVIEW_SYNTHESIS.md](../DISCOVERY/INTERVIEW_SYNTHESIS.md) T1, T2, T5, T7; JS-01, JS-06 |
| Bet 2 | O2 — Real-time hours/location sync and open/closed status | [INTERVIEW_SYNTHESIS.md](../DISCOVERY/INTERVIEW_SYNTHESIS.md) T4; JS-02 |
| Bet 3 | O7 — Harnessed AI Website Assistant; O9 — Versioned/revertible changes | [INTERVIEW_SYNTHESIS.md](../DISCOVERY/INTERVIEW_SYNTHESIS.md) T6, T9; JS-07, JS-09; [ADR 0003](../adr/0003-ai-assistant-harness.md) |
