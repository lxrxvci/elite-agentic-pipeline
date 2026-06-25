# Dependency Map

| Attribute | Value |
|---|---|
| Product | Foodcart SaaS |
| Version | 0.2.0-shaping |
| Author | Tech Lead |
| Date | 2026-06-24 |

## Internal Dependencies

Internal dependencies are components we build and operate ourselves.

```
                    ┌─────────────────────┐
                    │   Admin Dashboard   │
                    │   (Next.js App)     │
                    └──────────┬──────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
┌───────────────┐     ┌─────────────────┐     ┌──────────────┐
│ Consumer Site │     │  FastAPI API    │     │ CI / GitHub  │
│ (Next.js App) │◄────│  (Modular Mono) │     │   Actions    │
└───────┬───────┘     └────────┬────────┘     └──────────────┘
        │                      │
        │         ┌────────────┼────────────┐
        │         │            │            │
        ▼         ▼            ▼            ▼
   ┌────────┐  ┌────────┐  ┌────────┐  ┌──────────────┐
   │  CDN   │  │PostgreSQL│  │ Redis  │  │ Object Store │
   └────────┘  └────────┘  └────────┘  │  (R2/S3)     │
                                       └──────────────┘
```

| From | To | Purpose | Coupling |
|---|---|---|---|
| Admin Dashboard | FastAPI API | CRUD for tenants, sites, content, AI proposals, revisions. | Strong |
| Admin Dashboard | Clerk | Authentication, session, role checks. | Strong |
| Consumer Site | FastAPI API | Fetch published site/content by slug; submit catering/contact forms. | Strong |
| Consumer Site | Object Store | Serve logo, hero, and menu images via CDN. | Strong |
| Consumer Site | CDN | Cache static generated pages and assets. | Medium |
| FastAPI API | PostgreSQL | Persist tenants, users, sites, content blocks, revisions, ingestion jobs, AI requests. | Strong |
| FastAPI API | Redis | Rate limiting, tenant quotas, caching, background job queue. | Medium |
| FastAPI API | Object Store | Read/write image assets. | Medium |
| FastAPI API | Unleash | Feature flags for templates, AI assistant, ingestion sources. | Medium |
| FastAPI API | Observability | Traces, metrics, structured logs. | Medium |
| CI / GitHub Actions | FastAPI API | Run contract, integration, and E2E tests. | Medium |
| CI / GitHub Actions | Consumer Site | Build, Lighthouse, a11y checks. | Medium |

## External Dependencies

External dependencies are third-party services or platforms outside our control.

| Service | Type | What we use it for | Criticality | Contingency |
|---|---|---|---|---|
| Clerk | Authentication / IAM | User sign-up, sign-in, sessions, webhooks, roles. | Critical | Manual JWT fallback not viable; must monitor Clerk status page. |
| Vercel | Hosting / Edge | Next.js consumer site and admin dashboard, edge middleware for subdomain routing, preview deployments. | Critical | Can deploy to alternative Node/edge host; DNS migration needed. |
| OpenAI / Anthropic | LLM API | AI assistant propose/apply, ingestion enrichment. | High | Fallback to manual editing; multi-provider abstraction. |
| Cloudflare R2 (or AWS S3) | Object storage | Logo/hero/menu images, generated assets. | High | Failover to another S3-compatible provider. |
| Google Business Profile / Places API | External data | Pull business name, hours, address, photos. | Medium | Graceful degradation to manual onboarding. |
| Yelp Fusion API | External data | Pull rating, photos, hours, address. | Low | Optional; manual override always available. |
| DoorDash / UberEats / Grubhub | External links | Deep links for ordering. | Medium | Store links as opaque URLs; user can update if links break. |
| Instagram / Facebook / TikTok | External links | Social profile links. | Low | Links only; no API dependency. |
| Unleash | Feature flagging | Roll out templates and AI features. | Medium | Environment-variable fallback. |
| Terraform providers / Docker Hub | DevOps | Infrastructure provisioning and base images. | Medium | Pin versions, mirror critical images. |

## Shaped-Bet Dependency Notes

| Bet | New or highlighted dependency | Why it matters |
|---|---|---|
| 10-Minute Publish Onboarding | Google Business Profile API + Yelp Fusion API + menu URL parsing | Ingestion is the critical path; SPIKE-002 must validate data quality and rate limits before build. |
| 10-Minute Publish Onboarding | Redis-backed job queue | Ingestion jobs are async and may be slow; Redis provides both queue and caching. |
| Live Open/Closed + Hours | IANA timezone database + `zoneinfo`/`pytz` | Wrong timezone = wrong status. Must be deterministic and tested. |
| AI Assistant with Guardrails | OpenAI/Anthropic structured-output API | Provider choice and prompt design determine accuracy and cost. SPIKE-001/004/005 required. |
| AI Assistant with Guardrails | Redis rate-limiting + tenant quota store | Prevents abuse and cost spikes. Must be in place before public beta. |

## Dependency Decision Log

| Decision | Rationale |
|---|---|
| Clerk over custom auth | Removes password/security liability; supports future team/organization features. |
| OpenAI/Anthropic only (no self-hosted model) | Faster time-to-market; evaluate cost/quality before investing in fine-tuning or open-source hosting. |
| S3-compatible object store over local disk | Stateless backends, CDN integration, and future custom domain support. |
| Vercel edge middleware for subdomain routing | Native to Next.js; keeps routing logic out of backend. |
| Ingestion sources ordered: GBP → Yelp → menu URL → manual | GBP has the richest structured data for restaurants; manual fallback is always the safety net. |

## Cycle 1 Technical Decision Log

| Decision | RFC / ADR | Rationale |
|---|---|---|
| Subdomain routing with slug-based tenant resolution | RFC 0001 / ADR 0005 | Matches product wedge; atomic slug reservation; Vercel edge middleware is native to the Next.js scaffold. |
| Content block schema v1 + template engine | RFC 0002 / ADR 0006 | Shared contract for onboarding, manual edits, AI, and ingestion; validated against all three reference templates. |
| AI assistant operation allowlist + guardrails | RFC 0003 / ADR 0003 | Mandatory preview/approval; deterministic allowlist; every change creates a revision snapshot. |
| Adapter-based ingestion from GBP/Yelp/menu URLs | RFC 0004 / ADR 0007 | Anti-corruption layers isolate platform churn; graceful degradation keeps onboarding flowing. |

## New or Updated Dependencies

| Dependency | Type | Purpose | Criticality | Contingency |
|---|---|---|---|---|
| Vercel edge middleware / wildcard DNS | Infrastructure | Resolve `*.foodcartsite.com` to the correct published site. | High | Path-based fallback behind feature flag. |
| PostgreSQL unique constraint on `sites.slug` | Data | Atomic slug reservation and collision prevention. | High | Manual slug dispute process. |
| JSON Schema / Pydantic v2 validator | Backend | Validate every content block against its block-type schema. | High | Reject malformed blocks; do not persist. |
| Google Business Profile OAuth + Places API | External | Primary ingestion source for name, hours, address, photos. | High | Manual onboarding fallback. |
| Yelp Fusion API | External | Secondary ingestion source for hours, photos, and rating. | Medium | Manual onboarding fallback. |
| Menu URL parser (structured HTML) | Internal | Normalize menu pages into menu block proposals. | Medium | Manual paste-to-menu entry. |
| Redis job queue | Internal | Async ingestion jobs and AI fallback queueing. | High | Run jobs synchronously with timeouts in local dev. |
| OpenAI / Anthropic structured-output API | External | Generate deterministic `ChangePreview` objects for AI edits. | High | Disable AI feature flag; manual editing remains. |
| Redis tenant quota store | Internal | Per-tenant AI propose/apply rate limits. | Medium | In-memory fallback with lower limits in local dev. |
