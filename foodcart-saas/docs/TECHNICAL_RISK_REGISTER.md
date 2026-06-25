# Technical Risk Register

| Attribute | Value |
|---|---|
| Product | Foodcart SaaS |
| Version | 0.3.0-rfc-accepted |
| Author | Tech Lead |
| Date | 2026-06-24 |
| Review cadence | Weekly during discovery/shaping; monthly in build |

## Risk Scoring

| Rating | Likelihood | Impact |
|---|---|---|
| Critical | High | High |
| High | High / Medium | Medium / High |
| Medium | Medium | Medium |
| Low | Low | Low / Medium |

## Active Risks

| ID | Risk | Area | Likelihood | Impact | Rating | Mitigation | Owner | Status | Spike |
|---|---|---|---|---|---|---|---|---|---|
| R1 | LLM produces incorrect menu items, prices, or hours that are published without sufficient review. | AI / Content | Medium | High | High | Structured output, schema validation, mandatory diff + approval, revision snapshots, confidence threshold, fallback to manual editing. | Tech Lead | Open | SPIKE-004 |
| R2 | Data ingestion from Google Business Profile, Yelp, or menu URLs breaks due to layout changes, anti-scraping, or API limits. | Ingestion | High | Medium | High | Anti-corruption layers, graceful degradation to manual input, cached raw payloads, ingestion health metrics, user override. | Tech Lead | Open | SPIKE-002 |
| R3 | Cross-tenant data leakage via subdomain routing, AI assistant, or shared cache keys. | Security | Low | High | High | Row-level tenant isolation, tenant_id in every query, middleware subdomain validation, separate cache namespaces, integration tests for isolation. | Tech Lead | Open | — |
| R4 | Third-party delivery/social platforms change link formats or block deep linking. | Integrations | Medium | Medium | Medium | Store links only (do not depend on their APIs), periodic health checks, allow users to update links in admin. | Tech Lead | Open | — |
| R5 | Custom domain and SSL management becomes complex or unsafe when shipped. | Infrastructure | Medium | Medium | Medium | Defer to post-MVP; design DNS/SSL anti-corruption layer now; evaluate Cloudflare for SaaS or Vercel custom domains. | Tech Lead | Open | — |
| R6 | Image/asset storage costs or latency degrade consumer site performance. | Performance | Medium | Medium | Medium | Use S3-compatible object store + CDN, Next.js Image optimization, upload size/format limits, WebP/AVIF. | Tech Lead | Open | — |
| R7 | Prompt injection or adversarial use of the AI assistant. | AI / Security | Medium | High | High | System prompt hardening, input/output validation, operation allowlist, no destructive actions, rate limits, audit logs, red-team spike. | Tech Lead | Open | SPIKE-005 |
| R8 | Long LLM calls exceed serverless/function timeout limits. | Performance | Medium | Medium | Medium | 30-second timeout, streaming responses, background job queue for ingestion-heavy AI tasks, fallback to manual editing. | Tech Lead | Open | — |
| R9 | Reference templates (GSAP/Lenis animations) hurt Core Web Vitals on mobile networks. | Frontend | Medium | Medium | Medium | Lazy-load below-fold animations, respect `prefers-reduced-motion`, Lighthouse CI gate, asset optimization. | Tech Lead | Open | — |
| R10 | Subscription billing integration (future) forces data-model rework. | Billing | Medium | Medium | Medium | Add billing stubs to Tenant context now, keep billing logic behind an interface, do not entangle it with content. | Tech Lead | Open | — |
| R11 | **Slug reservation race conditions or non-URL-safe collisions break onboarding.** | Onboarding / Data | Medium | High | High | Database unique constraint on `slug`, atomic create-or-reserve flow, server-side slug normalization, validate before account creation. | Tech Lead | Open | — |
| R12 | **Timezone/DST errors in open/closed status cause wrong live status.** | Scheduling | Medium | High | High | Use IANA timezone names, standard libraries (`zoneinfo`), explicit timezone in location block, automated DST transition tests. | Tech Lead | Open | — |
| R13 | **Owners reject AI proposals because scope feels too narrow or diff is unclear.** | AI / UX | Medium | Medium | Medium | Clear "out of scope" messaging, human-readable summaries, side-by-side diff, easy manual fallback, usage analytics. | Tech Lead | Open | SPIKE-004 |
| R14 | **Onboarding ingestion produces incomplete or misleading first-pass content, damaging trust.** | Ingestion / UX | High | Medium | High | Confidence scoring per source, owner preview/approval before publish, manual fallback for every field, ingestion job status visibility. | Tech Lead | Open | SPIKE-002 |
| R15 | Content block schema does not fully express one of the three reference templates, causing render failures or missing sections. | Content / Frontend | Medium | Medium | Medium | SPIKE-003 validates every block type against every template; additive schema changes only in Cycle 1. | Tech Lead | Open | SPIKE-003 |
| R16 | AI patch path or prompt injection bypasses the operation allowlist. | AI / Security | Low | High | High | Strict JSON-Pointer path validation against known block IDs/fields, system prompt hardening, output schema validation, red-team spike (SPIKE-005). | Tech Lead | Open | SPIKE-005 |
| R17 | Subdomain routing or slug resolution serves the wrong tenant's published site. | Security / Routing | Low | High | High | Integration tests for isolation, tenant-scoped cache namespaces, edge middleware lookup only returns published sites. | Tech Lead | Open | — |
| R18 | Menu URL parser fails on PDF, image, or heavily dynamic pages, leaving the menu empty. | Ingestion / UX | High | Medium | High | Explicitly out of scope for Cycle 1; manual paste-to-menu fallback; retry with simpler HTML pages. | Tech Lead | Open | SPIKE-002 |
| R19 | Google Business Profile or Yelp OAuth token revocation breaks ingestion retries for existing tenants. | Integrations | Medium | Medium | Medium | Surface re-connect UI in admin; treat tokens as refreshable; fall back to manual data. | Tech Lead | Open | — |

## Recently Closed

None yet.

## Watch List

- LLM pricing changes after launch.
- PostgreSQL JSONB query performance as content blocks grow.
- Clerk organization features if we move from one-user-per-tenant to team accounts.
- Google Business Profile API policy changes for food trucks/mobile vendors.
- Vercel edge middleware cold-start latency under subdomain routing load.

## Shaping-stage notes

- R2 and R14 are closely related; R14 captures the trust/UX impact of ingestion failures.
- R11 and R12 are new shaped-bet risks identified during feasibility review.
- R13 is a UX risk that can derail AI assistant adoption even if the harness is technically safe.
