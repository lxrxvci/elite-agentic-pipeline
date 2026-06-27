# Release Notes — Foodcart SaaS Cycle 1

| Attribute | Value |
|---|---|
| **Version** | 0.3.0 |
| **Release** | Cycle 1 — MVP Foundation + Billing & Custom Domains |
| **Release date** | 2026-06-27 |
| **Status** | Deployed to production; progressive rollout in progress |
| **Owner** | Product Owner |
| **Deployment docs** | `docs/DEPLOYMENT.md` |
| **SLOs** | `docs/SLOs.md` |

---

## Release overview

Cycle 1 delivers the core Foodcart SaaS value proposition: a food-cart or small-restaurant owner can sign up and publish a complete, mobile-first single-page website in under ten minutes, and customers always see an accurate live open/closed status.

The release is deployed behind feature flags and will be promoted ring-by-ring (internal → 1–5% → 10–25% → general availability). The AI Website Assistant remains an internal-only spike and is **not** enabled for customers in this release.

---

## What is being released

### Bet 1 — 10-Minute Publish Onboarding (GA)

- **Clerk-powered signup & instant tenant provisioning** — each new business gets a unique `slug.foodcartsite.com` on registration.
- **5-step onboarding wizard** — business identity, slug reservation, cuisine type, existing presence links, brand assets, template choice, preview, and publish.
- **Ingestion adapters** — primary Google Business Profile import with manual fallback for Yelp, DoorDash, UberEats, Grubhub, Instagram, Facebook, TikTok, existing website, and menu URL.
- **Three food-native templates** — **Banh Mi Fusion** (bold/diagonal), **Real Indian Food** (warm/heritage), and **Mis Abuelos** (family/Mexican warmth).
- **Generated site sections** — hero, about/story, menu, locations/hours, catering, contact, social links, and order links.
- **Admin dashboard** — mobile-first editor to update business info, preview draft changes, and toggle publish/unpublish.
- **Tenant isolation** — enforced at API and data layers; no cross-tenant read or mutation.

### Bet 2 — Subscription Billing & Custom Domains (GA)

- **Paddle Billing integration** — `base` plan with monthly ($50) and yearly ($400) intervals, checkout, customer portal, cancel/resume, and webhook reconciliation.
- **Subscription lifecycle APIs** — `/billing/plans`, `/billing/current`, `/billing/checkout`, `/billing/portal`, `/billing/cancel`, `/billing/resume`, and `/webhooks/paddle`.
- **Custom domain connection** — owners can connect external domains or purchase domains through the registrar integration.
- **Domain management APIs** — `/domains/search`, `/domains/check`, `/domains/sites/{site_id}/purchase`, `/sites/{site_id}/domain`, and `/sites/{site_id}/domain/status`.
- **DNS verification** — automatic verification that a connected domain points to the platform.

### Bet 3 — Live Open/Closed + Hours Management (GA)

- **Timezone-aware hours editor** — day rows, open/closed toggles, copy-across-days, and special-hours overrides for the next 14 days.
- **Hours import** from Google Business Profile during onboarding, owner-editable at any time.
- **Live open/closed badge** on the public site with helper text (e.g., "Opens today at 11am").
- **Location block** — address, phone, map link, and optional "find us" note for rotating carts.
- **Cache invalidation** when hours change, verified through ISR.

### Bet 4 — Photo-driven Business Discovery (flagged preview)

- **Photo upload step** in the onboarding wizard lets owners upload a photo of
  their storefront, truck, menu, or business card.
- **Presigned uploads** to Cloudflare R2 via `POST /api/v1/uploads/presigned`.
- **Vision extraction** with Google Gemini parses business name, cuisine, hours,
  phone, address, and web/social/order links.
- **Places enrichment** with Google Places API (New) fills in missing details
  and cross-checks extracted values.
- **Graceful fallback** to manual entry when extraction confidence is low or any
  downstream call fails.
- **Full observability**: Prometheus counters/histograms, OpenTelemetry spans,
  structured logs, Grafana dashboards, and frontend RUM telemetry events.

---

## What is behind feature flags

| Flag | Status | Notes |
|---|---|---|
| `ai-assistant-spike` | **Internal only / OFF by default** | AI Website Assistant is a spike in Cycle 1, not a customer-facing release. It is gated to internal Ring 0 users only so the team can validate prompt → `ChangePreview` → approve/reject flows without exposing customers to guardrail risk. |
| `onboarding-v1` | **ON for Ring 0–3** | New onboarding flow; will be removed once fully GA. |
| `live-hours-v1` | **ON for Ring 0–3** | Live hours badge and editor; will be removed once fully GA. |
| `photo-onboarding-v1` | **ON for Ring 0, pending Ring 1** | Photo-driven onboarding. Requires object storage credentials, `GEMINI_API_KEY`, and Google Places API key. Progressive rollout after Ring 0 validation. |

> **Flag cleanup deadline:** all Cycle 1 GA flags must be removed within 30 days of Ring 3 promotion (target 2026-07-25). See `BACKLOG.md` → "Feature Flag Cleanup."

---

## What is deferred

The following opportunities are intentionally **not** in Cycle 1 and are queued for Cycle 2 discovery or shaping:

- **AI Website Assistant full build** — pending spike success criteria and capacity availability.
- **Catering lead capture flow** — static catering section only in Cycle 1.
- **Direct order links & click-share analytics** — order links are present but not yet instrumented for share analytics.
- **Multi-location dashboard** — Cycle 1 supports a single location per site.
- **Advanced owner analytics dashboard** — basic event instrumentation only.
- **Native checkout / online ordering, AI-generated social posts, reservations** — iceboxed per roadmap.

---

## Known issues and limitations

| # | Issue / limitation | Impact | Mitigation / next step |
|---|---|---|---|
| 1 | `TemplateSelector` uses raw `<img>` tags for template thumbnails, producing 4 ESLint warnings (`@next/next/no-img-element`). | Potential LCP regression on slow networks. | Switch to `next/image` with a custom loader during Cycle 2 flag cleanup. |
| 2 | Menu ingestion is limited to structured menu URLs and manual entry. PDF/image menu extraction is **not** supported. | Owners with PDF-only menus must paste or type items. | Explicit manual fallback in onboarding; PDF/image extraction added to discovery queue. |
| 3 | Catering section is static content. No lead-capture form, notifications, or CRM integration. | Catering inquiries still go to email/phone/social. | Lead-capture flow is the top Cycle 2 candidate after AI assistant. |
| 4 | Single-location only. Multi-location owners must create one site per location. | Mini-chain segment not served. | Multi-location support queued for Cycle 2 shaping. |
| 5 | AI assistant is behind a flag and not exposed to pilots. | No AI differentiation in customer-facing release. | Spike runs in Ring 0; full build planned for Cycle 2 if criteria pass. |
| 6 | Live hours depend on owner-entered data and Google Business Profile import. No POS integration or weather-based closure automation. | Owners must manually update exceptional closures. | Mobile hours editor target is <60 seconds per update. |
| 7 | Frontend telemetry events are ingested at `POST /api/v1/telemetry` and counted in `elite_telemetry_events_total`. | None — RUM events are now logged and measured. | Monitor event volume and consider sampling if cardinality becomes high. |
| 8 | New `deploy.yml`, `pr-environment.yml`, and Terraform storage modules are code-complete but not yet exercised with real cloud secrets. | Pipelines cannot run end-to-end until GitHub/AWS/Vercel secrets are configured. | Populate secrets using `.env.github-secrets.template` and `scripts/bootstrap_deploy_config.py`, then run a dry deploy. |

---

## Rollout status

| Ring | Audience | Traffic | Duration | Entry criteria | Status |
|---|---|---|---|---|---|
| Ring 0 | Internal team + design partners | 5–20 tenants | 24–48 hours | Staging smoke tests pass; no SEV1/2 | **In progress** |
| Ring 1 | Pilot food-cart owners | 1–5% of invite list | 24 hours | Ring 0 stable; error rate <0.1%; p95 <300 ms | Pending |
| Ring 2 | Expanded pilot | 10–25% of invite list | 24–48 hours | Ring 1 stable; no wrong-hours complaints | Pending |
| Ring 3 | General availability | 100% | Ongoing | Ring 2 stable; no unresolved SLO violations | Pending |

Backend canary is configured at 5% via Vercel Edge Config and will auto-promote or auto-rollback based on the gates in `docs/DEPLOYMENT.md`.

---

## Metrics and SLOs

Cycle 1 is measured against:

- **North Star:** Weekly Active Site Engagement (WASE) ≥ 35% (baseline established during pilot).
- **Activation:** 24-hour publish rate ≥ 60% of signups.
- **Time to publish:** median < 10 minutes in task-based tests.
- **Owner brand-match rating:** ≥ 70% "good or great" on post-publish micro-survey.
- **Trust:** 0 wrong-hours complaints in first 30 days of pilot.
- **Performance:** Mobile LCP < 2.5 s; p95 API latency < 300 ms; error rate < 0.1%.
- **Photo upload success rate** ≥ 99%.
- **Photo enrichment success rate** ≥ 95%.
- **Vision p95 latency** < 5 s; **Places p95 latency** < 5 s.

See `METRICS.md` and `docs/SLOs.md` for full definitions, dashboards, and alert thresholds.

---

## How to report feedback

- **Internal team:** `#foodcart-releases` Slack channel.
- **Pilot customers:** `#foodcart-pilots` Slack channel or `pilots@foodcartsite.com`.
- **Incidents / SLO violations:** `#incidents` (SEV2/SEV3) or `#war-room` (SEV1).
- **Product feedback:** File in GitHub Discussions or mention the Product Owner.

---

## Related documents

- `docs/DEPLOYMENT.md` — deployment flow, canary, rollback.
- `docs/SLOs.md` — service-level objectives and error budget.
- `BACKLOG.md` — post-release backlog and Cycle 2 commitments.
- `docs/STAKEHOLDER_DECISION_LOG.md` — release go/no-go criteria and accepted risks.
