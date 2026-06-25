# ADR 0001: Choose Default Application Stack for Foodcart SaaS

| Field | Value |
|---|---|
| Status | Proposed |
| Date | 2026-06-24 |
| Author | Tech Lead |
| Deciders | Product Strategist, UX Researcher, Tech Lead |

## Context

Foodcart SaaS is a multi-tenant no-code website builder for food carts and small restaurants. The product brief calls for:

- A polished, mobile-first single-page consumer site per tenant (subdomain `slug.foodcartsite.com`).
- An admin dashboard to edit business info, preview, and publish.
- Data ingestion from Google Business Profile, Yelp, delivery platforms, social links, and menu URLs.
- An AI Website Assistant that proposes structured content changes and applies them only after explicit approval.
- Tenant isolation, versioned/revertible changes, custom domains, and subscription billing in the future.

The existing project scaffold already uses Next.js, FastAPI, PostgreSQL, Clerk, Redis, Unleash, Docker, Terraform, and an observability stack. We must decide whether to reuse this scaffold or introduce new technology.

## Decision

We will reuse and extend the existing scaffold with the following default stack:

| Layer | Technology | Rationale |
|---|---|---|
| Consumer frontend | Next.js 15+ (App Router) | Subdomain-aware middleware, SSG/SSR for SEO and fast first paint, image optimization, preview/publish toggles, and React-based template rendering. |
| Admin dashboard | Next.js (same app, role-aware routes) | Shared design system, auth session, and component library. Admin routes protected by Clerk and feature flags. |
| Backend API | FastAPI (Python 3.12+) | Pydantic v2 schemas, dependency injection, automatic OpenAPI generation, async support, and strong SQLAlchemy integration. Aligns with existing backend. |
| Database | PostgreSQL 16 | Row-level tenant isolation, JSONB for flexible content blocks, mature migrations via Alembic, and full ACID for revisions/billing. |
| Authentication | Clerk | Handles JWT sessions, user/org provisioning, webhooks, and future SSO. Keeps auth outside our code. |
| AI/LLM | OpenAI / Anthropic via HTTP APIs | Structured output (JSON mode / function calling) for deterministic content patches. No fine-tuning in the first milestone. |
| Caching & jobs | Redis | Rate limiting, tenant quotas, background ingestion jobs, and preview cache. |
| Feature flags | Unleash (existing) | Gradual rollout of templates, AI assistant, and ingestion sources. |
| Object storage | S3-compatible (Cloudflare R2 preferred) | Logo/hero/menu images, CDN-friendly, cost-effective. |
| Infrastructure | Vercel (frontend), Docker/Fly/EC2 (backend), Terraform | Matches current deployment patterns; custom domains deferred. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Supabase + Remix | Supabase is attractive for rapid prototyping, but tenant isolation and future billing complexity push us toward an explicit backend. Remix would require rebuilding the scaffold. |
| Django + HTMX | Boring and productive, but the existing Next.js frontend and the need for mobile-first animations (GSAP/Lenis) make React a better fit. |
| Microservices | No evidence yet that the scale or team size requires separate services. Start with a modular monolith. |
| Fine-tuned LLM | Too expensive and uncertain for an MVP; structured prompting with frontier models is the cheaper experiment. |

## Consequences

### Positive

- Reuses working CI/CD, observability, auth, and tenant isolation patterns from the scaffold.
- Strongly typed end-to-end: Pydantic schemas feed FastAPI and can be mirrored in TypeScript.
- Next.js App Router makes subdomain routing, ISR, and preview environments straightforward.
- Clerk removes the need to build user management, password resets, or MFA.

### Negative / Risks

- LLM vendor coupling: switching providers requires prompt/schema adjustments.
- Next.js consumer sites with heavy GSAP/Lenis animations may need careful Core Web Vitals tuning.
- Long LLM calls on a serverless backend can hit timeout limits; we may need background jobs or streaming.
- AI assistant safety is not free; the harness adds complexity (see ADR 0003).

## Spikes

- **SPIKE-001**: Benchmark OpenAI vs Anthropic for menu/hours extraction accuracy and structured-change generation latency.
- **SPIKE-002**: Validate Google Business Profile / Yelp / menu URL ingestion feasibility, rate limits, and fallback behavior.
