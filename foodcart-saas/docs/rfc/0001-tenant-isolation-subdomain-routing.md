# RFC 0001: Tenant Isolation and Subdomain Routing

| Field | Value |
|---|---|
| Status | Proposed |
| Date | 2026-06-24 |
| Author | Tech Lead |

## Summary

Propose the Cycle 1 architecture for strict tenant isolation and slug-based subdomain routing so each business gets `slug.foodcartsite.com` while keeping tenant data separate and the routing layer simple.

## Problem

Foodcart SaaS is a multi-tenant SaaS. Each business publishes a site under a unique subdomain derived from a user-chosen slug. We must:

- Guarantee that one tenant cannot read or modify another tenant's sites, content, or revisions.
- Reserve subdomains atomically during onboarding so two businesses cannot claim the same slug.
- Resolve `slug.foodcartsite.com` to the correct published site with low latency.
- Lay a path for future custom domains without reworking the data model.

## Proposed solution

1. **Tenant column on every tenant-scoped table.**
   - `Tenant`, `User`, `Site`, `ContentBlock`, `Revision`, `AIRequest`, and `IngestionJob` all carry a `tenant_id` column.
   - Repository methods require `tenant_id` and reject cross-tenant queries.

2. **Globally unique, URL-safe slug.**
   - `sites.slug` is constrained unique in PostgreSQL.
   - Server-side normalization: lowercase, ASCII letters/digits/hyphens only, max 63 chars, no leading/trailing hyphen, no consecutive hyphens.
   - Onboarding reserves the slug atomically using `INSERT ... ON CONFLICT` so duplicate attempts fail fast.

3. **Subdomain resolution.**
   - Vercel edge middleware inspects the `Host` header for `*.foodcartsite.com`.
   - It looks up the slug and either fetches the published site or returns 404.
   - Draft content is never served on the public subdomain; a separate preview route requires a short-lived signed token.

4. **Admin context via Clerk JWT.**
   - The admin dashboard runs on `app.foodcartsite.com` and passes the tenant context through the Clerk JWT.
   - FastAPI dependencies `get_current_user` and `get_current_tenant` enforce membership.

5. **One active site per tenant in Cycle 1.**
   - Future multi-site support is not blocked, but the MVP invariant is one site per tenant.

6. **Custom-domain stub.**
   - The `Site` table includes a nullable `custom_domain` column but the feature is gated off for Cycle 1.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Path-based routing (`/s/slug`) | Simpler technically, but weakens the product wedge and SEO value of a clean subdomain. |
| Separate PostgreSQL schema or database per tenant | Strong isolation, but operational overhead (migrations, backups) is unjustified at MVP scale. |
| Custom domains in Cycle 1 | Deferred per shaped bet; DNS, SSL, and abuse handling add significant risk. |
| Slug reservation via Redis lock | Adds a distributed-system failure mode; the database unique constraint is sufficient and simpler. |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Cross-tenant data leakage | `tenant_id` filtering in every repository query; separate Redis cache namespaces; integration tests that assert isolation. |
| Slug collision race | Database unique constraint plus atomic create-or-reserve flow; pre-flight availability check is advisory only. |
| Wrong tenant served due to routing bug | Edge middleware logs + integration tests; public lookup only returns `published` sites. |
| Preview token leaks draft content | Tokens are short-lived (15 min), signed with a backend secret, and scoped to a single `site_id`. |
| Future custom-domain migration | Anti-corruption layer for DNS/SSL providers designed now; `custom_domain` column already present. |

## Rollback plan

- Subdomain routing can fall back to path-based routing behind a feature flag if edge middleware fails.
- Slug uniqueness is effectively irreversible once production slugs are reserved. Mitigate by validating the reservation flow thoroughly in staging and by keeping a slug ban-list for offensive terms.

## Dependencies

- Clerk user/tenant provisioning and JWT verification.
- Vercel wildcard DNS + edge middleware (or equivalent).
- PostgreSQL unique constraints.
- FastAPI dependency-injection layer.

## Timeline

Cycle 1 foundational work, part of Bet 1. Must be complete before onboarding can publish live sites.
