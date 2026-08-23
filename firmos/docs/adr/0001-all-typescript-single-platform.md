# ADR-0001: Single all-TypeScript platform (Next.js on Vercel) — no separate backend service

## Status

Accepted

## Context

The delivery pipeline's Golden Path scaffold generates a split system: Next.js frontend + FastAPI/Python backend. FirmOS is a wedge-stage product built by a small team, priced at $9–$19/client/mo, where operational cost and shipping speed dominate. Its hardest logic (accounting-month attribution, interval math) is pure computation that does not care about language — but the predecessor codebase's rules are pinned in Python tests that must be translated once, not maintained twice.

## Decision

Build FirmOS as a single Next.js 16 App Router application in TypeScript on Vercel: React Server Components + server actions for mutations, route handlers for webhooks (Stripe, Inngest, Inngest AI). The domain core lives in `@firmos/attribution`, a framework-free TypeScript package with zero runtime dependencies, so it can later be extracted to a service or shared with workers without churn. The pipeline scaffold is overridden accordingly and this ADR records the deviation.

## Consequences

Easier: one deploy target (Vercel), one type system from DB (Drizzle) to UI; no API versioning overhead pre-public-API; server actions keep client bundles small.
More difficult: compute-heavy future features (document OCR pipelines) may outgrow serverless — mitigated because `@firmos/attribution` stays portable; Python test translation is a one-time cost gated before UI work.

## Alternatives considered

- **Pipeline default (Next.js + FastAPI):** two platforms, two deploys, duplicated types via OpenAPI codegen; rejected for wedge stage — revisit if document-intelligence workloads demand Python.
- **Next.js + tRPC/Hono service:** adds a second deploy unit without adding capability at this stage; rejected.

## Related

- ADR-0002 (Neon/Drizzle), docs/SHAPED_BETS.md Bet 1

