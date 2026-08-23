# ADR-0003: Inngest durable functions instead of raw Vercel Cron

## Status

Accepted

## Context

Yecny ran 9 scheduler jobs from an always-on scheduler container, including three sub-hourly jobs (5-minute cadence). Its migration runbook flags that Vercel Cron requires Pro for sub-hourly schedules and warns about double-notification risk if old and new schedulers ever overlap. SaaS multi-tenant scheduling needs per-org fan-out with retries.

## Decision

Use Inngest for all background work: daily recurring-rule materialization, due-soon/overdue checks, statement-overdue scans, invoice runs, payroll calculations (Phase 2), and any sub-hourly sweeps. Vercel Cron may *trigger* Inngest flows where a simple schedule suffices; Inngest owns concurrency keys, retries, and idempotency. Every job must be safe to run twice (idempotent upserts keyed on org + period), eliminating the double-fire class of bugs by construction.

## Consequences

Easier: no always-on worker to operate; per-org concurrency keys prevent notification storms; retries and replay come free; local dev via Inngest Dev Server.
More difficult: another vendor dependency; flow functions have a learning curve; cold-start latency irrelevant for jobs but noted.

## Alternatives considered

- **Raw Vercel Cron:** Pro plan required for sub-hourly; no retries/durability; rejected.
- **Self-hosted scheduler container (Yecny-style):** reintroduces ops burden the SaaS exists to escape; rejected.
- **QStash / Trigger.dev:** viable, but Inngest's Vercel integration, concurrency keys, and flow steps best match the materialization/retry semantics.

## Related

- Yecny MIGRATION-RUNBOOK.md Phase 3 scheduler caveat, ADR-0001
