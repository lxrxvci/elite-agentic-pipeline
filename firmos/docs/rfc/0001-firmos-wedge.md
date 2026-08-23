# RFC-0001: FirmOS Wedge (Workstation v1) — build approach

**Status:** Approved · **Owner:** Tech Lead · **Reviewers:** Product Strategist, DevOps/SRE, Security Champion · **Time-box:** 3–5 business days

## Problem

Execute Bet 1 (docs/SHAPED_BETS.md): a multi-tenant Workstation that materializes recurring bookkeeping work into correctly-attributed dated items and lets firms complete it from one queue — on Vercel, by a 1-person team, at $9–$19/client/mo price points.

## Proposed solution

Single Next.js 16 app (ADR-0001) · Neon + Drizzle with `org_id` RLS (ADR-0002) · Inngest jobs (ADR-0003) · Better Auth + request→apply approvals (ADR-0004).

Build order is fixed by risk:

1. `@firmos/attribution` TS package FIRST: port Yecny's attribution rules (close tiers, catch-up dates, deferred-until), interval-union math, and health scoring; translate the pinning Python tests to Vitest property tests. **Gate: green before any UI.**
2. Schema + RLS policies + adversarial policy tests.
3. Org onboarding, invites, client records.
4. Inngest materialization job (daily; idempotent per org+period).
5. Workstation queue UI (RSC + server actions): complete/reopen, reverse-sync.
6. Resend due-soon/overdue digests (firm-local timezone semantics carried from Yecny).
7. Client portal slice (Blob signed URLs, waiting-on-you).
8. Health score + owner dashboard; Stripe metered billing.

## Alternatives

See ADR-0001 alternatives (FastAPI split rejected); schema-per-tenant rejected (ADR-0002).

## Risks

| Risk | Mitigation |
|---|---|
| Rule mistranslation Python→TS | Tests-first gate; differential fixtures from production pg_dump |
| RLS policy gaps | Adversarial test suite (Yecny audit-suite discipline) |
| Vendor sprawl (Neon, Inngest, Upstash, Resend) | Each behind a thin adapter; free tiers cover design-partner stage |

## Rollback plan

Vercel promotes are atomic per deployment; Neon branches make schema rollback a branch switch. No destructive migration ships without a tested down-path.

## API note

No public REST API in MVP — mutations via server actions; only webhook routes (Stripe, Inngest) are exposed. `openapi.yaml` deferred until the public API bet is shaped; recorded here so the exit criterion is explicitly waived, not forgotten.
