# ADR 0002: Domain Boundaries and Bounded Contexts

| Field | Value |
|---|---|
| Status | Proposed |
| Date | 2026-06-24 |
| Author | Tech Lead |

## Context

Foodcart SaaS spans several distinct problem areas: tenant management, public website generation, content editing, AI-assisted editing, and data ingestion from external platforms. To keep the codebase maintainable and avoid a big ball of mud, we need explicit bounded contexts inside the monolith.

## Decision

We will organize the backend as a **modular monolith** with five bounded contexts. Each context owns its aggregates, repositories, application services, and domain events. Cross-context communication happens only through well-defined application service interfaces or lightweight domain events.

```
┌─────────────────────────────────────────────────────────────┐
│                    FastAPI Modular Monolith                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────────┐ │
│  │ Tenant  │ │  Site   │ │ Content │ │   AI    │ │Ingestion│ │
│  │ Context │ │ Context │ │ Context │ │Assistant│ │ Context │ │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬───┘ │
│       │           │           │           │           │      │
│       └───────────┴───────────┴───────────┴───────────┘      │
│                         Shared Kernel                          │
│              (UUID, datetime, base entities, observability)   │
└─────────────────────────────────────────────────────────────┘
```

### 1. Tenant Context

**Responsibilities**
- Tenant lifecycle (create, archive).
- User provisioning via Clerk webhooks.
- Roles and permissions (`owner`, `editor`).
- Billing/account stubs for future subscription integration.

**Aggregate roots**
- `Tenant` (id, name, slug namespace, created_at, status).
- `User` (id, tenant_id, clerk_id, email, name, role).

**Invariant**
- A Clerk user belongs to exactly one tenant in this product phase.

### 2. Site Context

**Responsibilities**
- Subdomain slug reservation and uniqueness.
- Template selection (`banhmi`, `real-indian`, `mis-abuelos`, plus future templates).
- Publish state (`draft` | `published`) and preview tokens.
- Custom domain mapping (future; anti-corruption layer for DNS/SSL providers).
- SEO metadata (title, description, favicon).

**Aggregate root**
- `Site` (id, tenant_id, slug, template_id, status, metadata, created_at, updated_at).

**Invariant**
- Slug is globally unique and URL-safe. One active site per tenant in the MVP.

### 3. Content Context

**Responsibilities**
- Structured content blocks for each generated site.
- Schema validation per block type.
- Versioned snapshots for revert.
- Rendering contract for the Next.js consumer frontend.

**Aggregate root**
- `SiteContent` or `ContentBlock` collection keyed by `site_id`.

**Block types (v1)**
- `hero`: headline, subheadline, image_url, status_badge, ctas.
- `story`: eyebrow, heading, body, image_url, quote.
- `menu`: categories, items (name, description, price, dietary tags, image_url), featured carousel.
- `locations`: list of locations with address, phone, hours, timezone, map_url.
- `catering`: heading, services, inquiry form fields.
- `contact`: phone, email, social links.
- `order_links`: DoorDash, UberEats, Grubhub, own website.
- `footer`: copyright, nav, social links.

**Invariant**
- Every block belongs to exactly one site/tenant. Blocks are validated against a versioned JSON Schema.

### 4. AI Assistant Context

**Responsibilities**
- Parse natural-language requests.
- Generate structured, validated change previews.
- Apply approved changes through the Content context's application service.
- Enforce guardrails, tenant scoping, and rate limits.
- Emit `AIChangeProposed`, `AIChangeApplied`, `AIChangeRejected` events.

**Aggregate root**
- `AIRequest` (id, tenant_id, site_id, prompt, status, proposed_patch, applied_revision_id, created_at).

**Key rule**
- The AI context does not own content. It can only call an allowlist of mutation operations exposed by the Content context.

### 5. Ingestion Context

**Responsibilities**
- Fetch and normalize data from external sources.
- Map normalized data to Content block proposals.
- Idempotent ingestion jobs with failure isolation.
- Anti-corruption layers for Google Business Profile, Yelp, menu URLs, and social platforms.

**Aggregate root**
- `IngestionJob` (id, tenant_id, site_id, source_type, source_url, status, raw_payload, normalized_data, errors).

**Key rule**
- Ingestion produces proposals; it does not overwrite published content without explicit user approval.

## Cross-Context Communication Rules

1. **No direct repository sharing.** A context accesses another context's aggregates only through an application service interface.
2. **Domain events** are used for side effects (audit logs, analytics, search index updates), not for synchronous reads.
3. **External APIs** are wrapped in anti-corruption layers inside the Ingestion context.
4. **AI context** is a consumer of the Content context; it cannot call Tenant or Site contexts except to read IDs it already owns.

## Consequences

### Positive

- Clear ownership as the team grows.
- Each context can be extracted into its own service later if scale demands it.
- Unit and integration tests can target one context at a time.

### Negative

- Adds indirection; engineers must know which application service to call.
- Shared kernel (base entity, observability) needs careful versioning.

## Spikes

- **SPIKE-003**: Define the Content block JSON Schema and validate it renders correctly for all three reference templates.
