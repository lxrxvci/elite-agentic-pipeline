# ADR-0005: Single-tenant parity rebuild - supersedes ADR-0001..0004 stack scoping

**Status:** Accepted (2026-08-23) · **Supersedes:** ADR-0001 (all-TS single platform), ADR-0002 (Neon/Drizzle/RLS tenancy), ADR-0003 (Inngest), ADR-0004 (auth/approvals) **in scope, not in spirit** - the technology choices mostly stand; the multi-tenant SaaS framing does not.

## Context

The first build attempt (2026-08-22/23) kept the pipeline's generic freelancer time-tracking scaffold and skinned one page. Audit verdict: 0 of 26 target domain areas built; the workstation was mock data; the backend was a 7-table freelancer-billing schema; the pipeline gates reported green on scaffold health. The engagement goal is **single-tenant feature parity with Yecny Bookkeeping OS at elite UX quality** (see `FIRMOS-ELITE-REMEDIATION-PLAN.md` at the workspace root), not a multi-tenant SaaS launch.

## Decision

1. **Single tenant.** No `tenant_id`/`org_id` columns, no RLS, no Stripe, no self-serve org onboarding. The schema is designed so an `org_id` could be added later; it is not built.
2. **Single platform stands (ADR-0001's instinct):** Next.js 16 App Router + React 19 + TypeScript strict on Vercel. No FastAPI split - the split was the failed attempt's biggest architecture violation. Server components + server actions replace the hand-maintained SPA/API surface.
3. **Postgres 16 + Drizzle** stands, minus RLS/multi-tenancy. The **complete domain schema is modeled up front** from HANDOFF §7's 63-model inventory - Yecny's no-Alembic-baseline pain came from schema-by-accretion and is fixed by construction here.
4. **Inngest** stands for durable jobs (materialization, overdue checks, notification fan-out), replacing Yecny's 5-minute scheduler loop.
5. **Better Auth** with TOTP MFA replaces Clerk; staff/portal/CPA isolation enforced at middleware level, mirroring Yecny's dependency-level isolation. Portal kill switch returns 404.
6. **Vercel Blob + signed URLs** for documents, preserving Yecny's deterministic relative-path convention in metadata. **Resend** for email. Twilio/SMS deferred.
7. **Domain core first:** `@firmos/domain` (pure TS, DB-free) is ported rule-for-rule from HANDOFF §6 with executable rule tests written from the handoff's worked examples **before** any UI consumes it. Nothing else in the codebase may re-derive an accounting month, a client work state, a completion transition, an interval union, a commission tier, or a quote.

## Consequences

- All scaffold code for the freelancer product, the multi-tenant backend, the platform theater (19 workflows, Terraform, Grafana/Loki/Tempo, canary middleware, Pact), and `.pipeline/` state were demolished. Salvaged: `packages/domain` (née attribution), the oklch status-token system in `globals.css` + tailwind `firm`/`status` palettes, `shared/ui/work/`, `docs/DESIGN_MANDATE.md`.
- CI is a single workflow: domain tests, frontend typecheck/lint/test/build. Additional gates are re-added only when the product surface they guard exists.
- Data migration from the production droplet remains per `yecny/MIGRATION-RUNBOOK.md` and is gated on access per `yecny/CRUZ-HANDOFF-REQUEST.md`. Until then, development runs against synthetic seed fixtures modeled on HANDOFF §26's seven-persona/six-client adversarial world.
