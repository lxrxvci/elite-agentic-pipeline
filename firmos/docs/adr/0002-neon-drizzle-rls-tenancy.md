# ADR-0002: Neon Postgres with Drizzle ORM; multi-tenancy via org_id + RLS

## Status

Accepted

## Context

FirmOS is multi-tenant from day one (the entire premise vs. single-firm Yecny) and priced per client per month, so per-tenant database cost is unacceptable. The predecessor system suffered permanent schema-pain: no Alembic baseline, 120 migrations that cannot bootstrap an empty database, and prod/repo stamp drift. The delivery pipeline creates preview deployments per PR, which want isolated databases.

## Decision

Use Neon Postgres (serverless driver) accessed through Drizzle ORM. Every tenant-owned table carries `org_id`; Postgres Row-Level Security policies scope all reads/writes to the acting org, mirroring the portal-isolation pattern proven in Yecny and Denali. Schema is managed exclusively by Drizzle Kit migrations with a mandatory clean-database bootstrap test in CI (the failure mode Yecny never fixed).

## Consequences

Easier: branch-per-preview databases for every pipeline PR; typed schema shared with app code; cheap scale-to-zero at wedge pricing; CPA/portal scoping falls out of RLS rather than ad-hoc dependency checks.
More difficult: RLS policies are part of the schema and must be tested adversarially (Yecny's audit-suite discipline carries over); connection management via Neon pooler needs explicit configuration.

## Alternatives considered

- **Supabase:** strong RLS story but couples us to its platform; Neon keeps Vercel-first symmetry and better branching.
- **Schema-per-tenant / DB-per-tenant:** operationally heavy at $9/client pricing; rejected.
- **Shared-schema without RLS (app-level filtering only):** rejected — one missed `where` clause leaks cross-firm data; RLS is the backstop.

## Related

- ADR-0001, docs/THREAT_MODEL.md
