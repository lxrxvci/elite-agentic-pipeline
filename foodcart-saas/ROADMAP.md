# Roadmap: Foodcart SaaS

*Outcome-based roadmap. Each item maps to a customer outcome and a business outcome. Items are bets, not commitments, and require validated evidence before shaping.*

*Last updated: Observe & Improve stage, post-Cycle 1 review (2026-06-24).*

---

## Now (0–4 weeks)

### 1. Production Monitoring & SLO Dashboards
- **Customer outcome:** Customers see an accurate, reliable site; owners trust that orders and hours are always up.
- **Business outcome:** Meet 99.9% availability and <0.1% 5xx SLOs; catch regressions before they burn error budget.
- **Evidence from Cycle 1:** `METRICS.md` shows all live reliability, latency, and product metrics are still TBD. The first production tenants need golden-signal coverage before any ring expansion.
- **Feasibility:** Low; dashboards and alerts already scaffolded in `observability/` and `docs/SLOs.md`.
- **Kano lens:** Must-have (hygiene). A site builder that is down or slow destroys trust.

### 2. Bug Fix & Quality Blitz
- **Customer outcome:** Onboarding and hours management work flawlessly on real devices and browsers.
- **Business outcome:** Reduce bug escape rate and prevent activation drop-off from avoidable defects.
- **Evidence from Cycle 1:** Frontend coverage is 69.2% (below 80% target), driven by legacy scaffold pages and un-tested UI paths; lint flags unoptimized `<img>` tags that risk LCP regression; `METRICS.md` bottleneck #1 and #3.
- **Feasibility:** Low-medium; focused cleanup of scaffold debt, image optimization, and targeted test backfill.
- **Kano lens:** Must-have. Quality problems at launch compound into churn.

### 3. Feature Flag Cleanup
- **Customer outcome:** Stable, predictable behavior; no half-enabled features or confusing toggles.
- **Business outcome:** Lower operational complexity and fewer paths to accidentally break a shipped capability.
- **Evidence from Cycle 1:** `BACKLOG.md` post-release rule and Cycle 2 committed debt item; Cycle 1 GA capabilities (`onboarding-v1`, `live-hours-v1`) must be permanently enabled before new flags are added.
- **Feasibility:** Low; inventory and removal plan already drafted.
- **Kano lens:** Hygiene; unblocks Cycle 2 velocity.

---

## Next (4–12 weeks)

### 4. Photo-Driven Business Discovery

- **Customer outcome:** Owners onboard by snapping a photo of their cart; the platform finds the business and pre-fills name, address, hours, links, and hero image.
- **Business outcome:** Faster activation, higher 24-hour publish rate, and a differentiated onboarding experience.
- **Evidence from Cycle 1:** Onboarding drop-off at the Links step; `docs/SHAPED_BETS.md` Bet 4; natural extension of the ingestion strategy defined in ADR 0007 / RFC 0004.
- **Feasibility:** Medium; requires Cloudflare R2, Google Places API, and Gemini multimodal image analysis, but builds on existing onboarding and ingestion frameworks.
- **Kano lens:** Exciter / differentiator. Removes the most tedious part of onboarding.

### 5. AI Website Assistant Full Build
- **Customer outcome:** Owners update menu, hours, hero, and story by typing plain English — with every change previewed, approved, and revertible.
- **Business outcome:** Differentiation in a crowded builder market; target AI Edit Adoption >35% of active owners in 30 days and AI-assisted 30-day retention +20 pp over manual-only owners.
- **Evidence from Cycle 1:** `docs/SHAPED_BETS.md` Bet 3; interview synthesis shows 6/9 owners fear "breaking something" with AI but want faster updates; SPIKE-004 and SPIKE-005 gates defined in `BACKLOG.md`; Cycle 1 content-block model now provides the schema surface the assistant needs.
- **Feasibility:** Medium; ADR 0003 architecture and structured-output harness are in place, but cost, latency, and trust UX need validation.
- **Kano lens:** Exciter / differentiator. The safest AI assistant in the category is a wedge.

### 6. Foundational Owner Analytics Dashboard
- **Customer outcome:** Owners see simple, actionable metrics — site views, top CTA clicks, hours-badge impressions — so they know the site is working.
- **Business outcome:** Improve engagement, justify future pricing, and give the squad data to prioritize.
- **Evidence from Cycle 1:** `BACKLOG.md` Cycle 2 committed item; interview synthesis shows owners currently use Instagram insights or nothing; North Star WASE requires event instrumentation.
- **Feasibility:** Low-medium; depends on event schema already planned in Cycle 1.
- **Kano lens:** Performance / excitement once insights are actionable.

---

## Later (12+ weeks)

### 7. Subscription Billing & Plan Tiers
- **Customer outcome:** Clear, affordable plans that match the value the owner receives.
- **Business outcome:** Monetize the activated base and establish initial MRR.
- **Evidence needed:** Pricing sensitivity survey with 10+ owners; free-to-paid conversion baseline from foundational analytics.
- **Feasibility:** Medium; Stripe integration, plan enforcement, and usage metering.
- **Kano lens:** Must-have for business viability; not a customer exciter.

### 8. Custom Domain & White-Label Branding
- **Customer outcome:** The site feels fully owned by the restaurant (e.g., `www.banhmifusion.com`).
- **Business outcome:** Unlock higher willingness-to-pay and reduce visible platform branding.
- **Evidence needed:** ≥20% of Pro customers request or expect custom domains; shaped bet with DNS/SSL/edge-config feasibility.
- **Feasibility:** Medium-high; DNS, SSL, and edge config.
- **Kano lens:** Exciter for established businesses; must-have for premium tier.

### 9. Advanced Analytics & Performance Insights
- **Customer outcome:** Owners understand which menu items and traffic sources drive orders.
- **Business outcome:** Increase engagement and reduce churn by proving ROI.
- **Evidence needed:** Owners' willingness to pay for metrics beyond basic views/clicks; data from foundational dashboard.
- **Feasibility:** Medium; aggregate event pipeline, dashboards, weekly email summaries.
- **Kano lens:** Exciter if insights are actionable.

### 10. Multi-Location Support
- **Customer outcome:** A 2–3 location business manages all locations from one dashboard with consistent branding and per-location hours/menus.
- **Business outcome:** Expand ICP to growing mini-chains; unlock Growth tier pricing.
- **Evidence needed:** Validate with 2–3 mini-chain owners that location inconsistency is a real pain worth paying for.
- **Feasibility:** Medium; data model changes, subdomain routing, and dashboard UX.
- **Kano lens:** Must-have for mini-chain segment; irrelevant for solo operators.

---

## Deferred / Intentionally Not on Roadmap

| Request | Why Deferred |
|---|---|
| Full e-commerce / native checkout | Out of scope; competes with POS/delivery platforms and adds compliance burden. We link out instead. |
| AI-generated social media posts | Interesting, but not validated as a top pain; can be added after core site value is proven. |
| Reservation/booking system | Not a primary job for carts and counter-service restaurants. Catering form is the near-term alternative. |
| Multi-language auto-translation | Valuable in some markets; requires validation and extra design QA before prioritizing. |

---

## How We Prioritize

1. **Impact on WASE:** Does this move Weekly Active Site Engagement?
2. **Evidence strength:** Do we have direct customer signals (interviews, support, usage) or only assumptions?
3. **Feasibility:** Tech Lead 5-minute sniff test — go, no-go, or spike.
4. **Strategic fit:** Does it deepen our wedge (speed + food-specific + AI-assisted) or dilute it?

---

## Cycle 1 Learnings That Shaped This Roadmap

- **Live telemetry is the first priority.** Without real latency, error, and engagement data, every subsequent bet is flying blind. Monitoring moved from implicit to explicit in Now.
- **Quality debt compounds.** The frontend coverage gap and image optimization warnings are launch risks, so a quality blitz precedes the next feature build.
- **Feature flags are a liability after GA.** The post-release rule (cleanup first in every cycle) is now a roadmap-level commitment.
- **AI assistant is the next wedge — if trust is visible.** Cycle 1 proved the content-block model; Cycle 2 must prove owners will actually approve AI-proposed changes.
- **Billing, custom domains, and multi-location remain unvalidated.** They stay Later until foundational analytics and owner interviews provide evidence.
