# ADR 0005: Tenant Isolation and Subdomain Routing

| Field | Value |
|---|---|
| Status | Accepted |
| Date | 2026-06-24 |
| Author | Tech Lead |
| Deciders | Product Strategist, Backend Engineer, DevOps/SRE |

## Context

Foodcart SaaS must serve many businesses from a single deployment. Each business needs a branded public URL (`slug.foodcartsite.com`) and an isolated admin experience. The decision has cross-team impact (frontend routing, backend authorization, infrastructure/DNS) and is hard to reverse once production slugs are reserved.

## Decision

We will implement tenant isolation and subdomain routing as follows:

1. **Row-level tenant scoping.** Every tenant-scoped table includes `tenant_id`. Repository queries always filter by `tenant_id` supplied by the authenticated user or resolved subdomain.
2. **Globally unique slug.** `sites.slug` has a PostgreSQL unique constraint. Slugs are server-normalized (lowercase, letters/numbers/hyphens, max 63 chars). Slug reservation is atomic via `INSERT ... ON CONFLICT`.
3. **Subdomain routing.** Vercel edge middleware resolves `*.foodcartsite.com` to a published site. Draft sites are never served publicly; preview uses a short-lived signed token.
4. **Admin tenant context.** The admin dashboard authenticates via Clerk JWT; the backend resolves the tenant from the user token.
5. **One active site per tenant in Cycle 1.** Multi-site support is not blocked but not implemented.
6. **Custom-domain stub.** A nullable `custom_domain` column is added to `Site` but feature-flagged off.

## Consequences

### Positive

- Strong isolation boundary reduces the blast radius of authorization bugs.
- Subdomains reinforce the product wedge and improve SEO/shareability.
- Atomic slug reservation eliminates race conditions without distributed locks.
- Custom-domain path is preserved without rework.

### Negative

- Wildcard DNS and edge middleware add infrastructure complexity.
- Slug uniqueness is an irreversible commitment once production tenants exist.
- Preview tokens must be carefully signed and short-lived to avoid leaking drafts.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Path-based routing | Weakens brand and SEO; rejected. |
| Separate DB/schema per tenant | Operational overhead too high for MVP; rejected. |
| Custom domains now | Out of shaped-bet scope; rejected. |
| Redis-based slug lock | Adds failure mode; database constraint is sufficient. |

## Related

- RFC 0001: Tenant Isolation and Subdomain Routing
- ADR 0002: Domain Boundaries and Bounded Contexts
- `docs/TECHNICAL_RISK_REGISTER.md` (R3, R11)
