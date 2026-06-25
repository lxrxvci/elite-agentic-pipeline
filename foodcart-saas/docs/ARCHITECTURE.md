# Foodcart SaaS — High-Level Architecture

| Attribute | Value |
|---|---|
| Product | Foodcart SaaS |
| Version | 0.2.0-rfc-accepted |
| Author | Tech Lead |
| Date | 2026-06-24 |
| Status | Draft / Proposed |

## Goals

- Generate a polished, mobile-first single-page restaurant website per tenant.
- Keep tenant data strictly isolated.
- Let non-technical owners edit content manually or with an AI assistant.
- Ingest public business data to reduce onboarding friction.
- Support preview/publish and future custom domains/billing.

## Architectural Principles

1. **Modular monolith first.** Extract services only when data proves it.
2. **Boring technology.** Reuse the existing Next.js + FastAPI + PostgreSQL scaffold.
3. **API-first.** The OpenAPI contract is the source of truth for frontend/backend integration.
4. **Tenant isolation by design.** Every data access path is filtered by `tenant_id`.
5. **AI as a controlled tool.** The assistant cannot act autonomously or destructively.
6. **Version everything.** Content changes create immutable revisions.

## System Context

```
        ┌─────────────────────────────────────────────────────────────┐
        │                         Foodcart SaaS                        │
        │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
        │  │ Business    │  │ Public      │  │ Admin Dashboard     │  │
        │  │ Owner       │  │ Visitor     │  │ (Next.js)           │  │
        │  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
        └─────────┼────────────────┼────────────────────┼─────────────┘
                  │                │                    │
                  │                │                    │
        ┌─────────▼────────────────▼────────────────────▼─────────────┐
        │                    FastAPI Backend                          │
        │  Tenant │ Site │ Content │ AI Assistant │ Ingestion         │
        └─────────────────────────────────────────────────────────────┘
```

## Container Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                    Tenant                                    │
│  ┌─────────────────────┐        ┌─────────────────────┐                     │
│  │ Admin Dashboard     │        │ Consumer Site       │                     │
│  │ Next.js App Router  │        │ Next.js (SSG/ISR)   │  slug.foodcartsite.com
│  │ clerk auth          │        │ edge middleware     │                     │
│  └──────────┬──────────┘        └──────────┬──────────┘                     │
│             │ HTTPS                         │ HTTPS                          │
│             │                               │                                │
│             └───────────────┬───────────────┘                                │
│                             │                                                │
│                    ┌────────▼────────┐                                       │
│                    │  FastAPI API    │                                       │
│                    │  /api/v1/...    │                                       │
│                    └────────┬────────┘                                       │
│                             │                                                │
│        ┌────────────────────┼────────────────────┐                           │
│        │                    │                    │                           │
│        ▼                    ▼                    ▼                           │
│   ┌──────────┐       ┌──────────┐       ┌──────────────┐                     │
│   │PostgreSQL│       │  Redis   │       │ Object Store │                     │
│   │ 16 + JSONB│       │ cache/jobs│      │  R2 / S3     │                     │
│   └──────────┘       └──────────┘       └──────────────┘                     │
│                                                                              │
│   External: Clerk (auth) │ OpenAI/Anthropic (LLM) │ GBP/Yelp/Social APIs    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Subdomain Routing and Preview

- Consumer requests hit `slug.foodcartsite.com`.
- Vercel edge middleware resolves `slug` to a tenant/site and either:
  - Serves a statically generated page for the published site, or
  - Returns a 404 if the slug does not exist.
- Admin dashboard uses `app.foodcartsite.com` (or `/admin` path) and passes the tenant context via Clerk JWT.
- Preview mode uses a short-lived signed token (`?preview=TOKEN`) so owners can see draft content before publishing.

## Bounded Contexts

See [ADR 0002: Domain Boundaries](adr/0002-domain-boundaries.md) for details.

| Context | Owns |
|---|---|
| Tenant | Users, roles, tenant lifecycle, billing stubs. |
| Site | Slug, template, publish state, custom-domain mapping (future). |
| Content | Structured blocks: hero, story, menu, locations, catering, contact, order links, footer. |
| AI Assistant | Parse requests, propose patches, apply approved changes under guardrails. |
| Ingestion | Fetch and normalize external business data into content proposals. |

## Data Model (Conceptual)

```
Tenant {
  id, name, slug_namespace, status, billing_status, created_at, updated_at
}

User {
  id, tenant_id, clerk_id, email, name, role, created_at, updated_at
}

Site {
  id, tenant_id, slug, template_id, status, seo, publish_state,
  custom_domain, created_at, updated_at
}

ContentBlock {
  id, site_id, tenant_id, block_type, schema_version, data, sort_order,
  created_at, updated_at
}

Revision {
  id, site_id, tenant_id, triggered_by, source, snapshot, created_at
}

AIRequest {
  id, tenant_id, site_id, prompt, status, proposed_patch, applied_revision_id,
  created_at, updated_at
}

IngestionJob {
  id, tenant_id, site_id, source_type, source_url, status,
  raw_payload, normalized_data, errors, created_at, updated_at
}
```

- `tenant_id` is present on every tenant-scoped table and enforced in repository queries.
- Content blocks are stored as JSONB and validated against versioned JSON Schemas.
- Revisions store the full content snapshot before a mutation, enabling one-click revert.

## Content Block Schema (v1)

Each generated site is composed of ordered blocks. The reference templates map blocks to sections:

| Block type | Maps to template section | Key fields |
|---|---|---|
| `hero` | HeroSection | headline, subheadline, image_url, status_badge, ctas, order_links |
| `story` | StorySection | eyebrow, heading, body, image_url, quote |
| `menu` | MenuSection | categories[], items[], featured[] |
| `locations` | LocationsSection | locations[] with hours, timezone, status |
| `catering` | CateringSection | heading, services[], form_fields |
| `contact` | Footer / contact | phone, email, social_links[] |
| `order_links` | OrderSection | doordash, ubereats, grubhub, website |
| `footer` | Footer | copyright, nav, social_links[] |

Template-specific design tokens (colors, fonts, animations) live in the frontend template package, not the database.

## AI Assistant Flow

1. **Propose**: Owner types a request. Backend sends current content + prompt to the LLM with a strict system prompt and JSON schema.
2. **Validate**: LLM output is parsed by Pydantic. Unknown operations or out-of-scope requests are rejected.
3. **Preview**: UI renders a before/after diff from the validated patch.
4. **Apply**: On explicit approval, backend creates a `Revision` snapshot, applies the patch through the Content context, and emits an event.
5. **Revert**: Owner can restore any previous revision from the admin dashboard.

See [ADR 0003: AI Assistant Harness](adr/0003-ai-assistant-harness.md) for guardrails.

## Ingestion Flow

1. Owner provides URLs during onboarding (Google Business Profile, Yelp, menu URL, social links, delivery links).
2. Backend creates `IngestionJob` records per source.
3. Workers (Redis-backed queue) fetch each source through an anti-corruption adapter.
4. Raw responses are cached; normalized data is produced.
5. Proposals are surfaced in the admin dashboard; owner approves before content is overwritten.
6. Failed sources degrade gracefully and show a manual-entry prompt.

## Security and Tenant Isolation

- Authentication via Clerk JWT; `get_current_user` enforces tenant membership.
- Every repository method requires `tenant_id` and rejects cross-tenant queries.
- Consumer site lookup by slug resolves to a published site only; draft content requires a valid preview token.
- AI assistant only receives the current tenant's content and can mutate only Content blocks.
- Security headers, CSP, rate limiting, and audit logging reuse the existing scaffold.

## Observability

- Structured logging with correlation IDs.
- OpenTelemetry traces through FastAPI and Next.js.
- Prometheus metrics for ingestion success/failure, AI propose/apply latency, and tenant quota usage.
- SLOs defined in [docs/SLOs.md](SLOs.md).

## Deployment

- Frontend: Vercel with ISR and edge middleware.
- Backend: Docker container (existing Dockerfile) or serverless function with timeout awareness.
- Database: PostgreSQL 16 (Docker locally, managed service in production).
- Redis: Docker locally, managed service in production.
- Object storage: Cloudflare R2 or AWS S3.
- Infrastructure as Code: Terraform (existing `infra/` directory).

## Spikes and Next Steps

| Spike | Topic | Goal |
|---|---|---|
| SPIKE-001 | LLM provider benchmark | Choose OpenAI vs Anthropic for menu/hours extraction. |
| SPIKE-002 | Ingestion feasibility | Determine API vs scraping strategy for GBP/Yelp/menu URLs. |
| SPIKE-003 | Content block schema | Validate that schema renders all three reference templates. |
| SPIKE-004 | AI change preview accuracy | Achieve >90% schema conformance on realistic prompts. |
| SPIKE-005 | Prompt-injection resistance | Red-team the AI assistant harness. |

## Decision Records

- [ADR 0001: Choose Default Stack](adr/0001-choose-default-stack.md)
- [ADR 0002: Domain Boundaries](adr/0002-domain-boundaries.md)
- [ADR 0003: AI Assistant Harness](adr/0003-ai-assistant-harness.md)
- [ADR 0004: Feasibility Review of Shaped Bets](adr/0004-feasibility-review-shaped-bets.md)
- [ADR 0005: Tenant Isolation and Subdomain Routing](adr/0005-tenant-isolation-subdomain-routing.md)
- [ADR 0006: Content Block Schema and Template Engine](adr/0006-content-block-schema-template-engine.md)
- [ADR 0007: External Platform Ingestion Strategy](adr/0007-external-platform-ingestion-strategy.md)

## Cycle 1 RFCs

- [RFC 0001: Tenant Isolation and Subdomain Routing](rfc/0001-tenant-isolation-subdomain-routing.md)
- [RFC 0002: Content Block Schema and Template Engine](rfc/0002-content-block-schema-template-engine.md)
- [RFC 0003: AI Assistant Operation Allowlist and Guardrails](rfc/0003-ai-assistant-allowlist-guardrails.md)
- [RFC 0004: External Platform Ingestion Strategy](rfc/0004-external-platform-ingestion-strategy.md)
