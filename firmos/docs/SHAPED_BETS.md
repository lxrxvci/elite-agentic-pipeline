# Shaped Bets

## Bet 1 — FirmOS Wedge: "The Workstation that knows which month it is"

**Decision: BET** (hand off to RFC/ADR workflow) · Cycle: 2026-Q3 · Appetite: 6–8 weeks

### Problem
Owners of 1–20 person bookkeeping firms run client work out of spreadsheets, QBO, email, and a PM tool that tracks calendar deadlines but not *accounting months*. They discover missed work when clients call; newly onboarded or behind clients show walls of false overdues; nobody can answer "is this firm OK?" with one number. (OST Outcomes 1–3; ASSUMPTIONS A2/A3.)

### Appetite
6–8 weeks of gated pipeline stages to a deployable MVP on Vercel with 3 design-partner firms.

### Solution sketch
1. Multi-tenant org model (org_id + RLS), team invites.
2. `@firmos/attribution` pure-TS domain core: accounting-month attribution (close tiers 5th/10th/15th, catch-up dates, deferred-until), interval-union time math, health scoring — ported test-first from Yecny's pinned Python rules.
3. Recurring rules → materialized dated work items via Inngest durable functions.
4. Workstation v1: unified queue; complete/reopen with reverse-sync to bank-feed/reconciliation/report rows; due-soon/overdue email (Resend).
5. Client portal slice: document upload (Vercel Blob signed URLs) + waiting-on-you view; uploads auto-create review tasks.
6. Owner dashboard: client health score.
7. Stripe metered billing ($9–$19/client/mo, unlimited seats).

### Rabbit holes (bounded out)
- QuickBooks Online sync (read-only CSV export only in v1)
- Realtime chat, push/SMS notifications
- Custom report builders; theming beyond design tokens

### No-gos for this cycle
- Intake quote engine, invoicing-from-actuals, commission payroll (Phase 2+ bets, OST Outcome 4)
- CPA portal, statements module, projects/properties/tax checklists
- AI work-item execution (A5) — differentiator track, does not block MVP

### Success criteria
- Attribution rule tests green before any UI ships (gate G3)
- One design-partner firm runs a full weekly cycle inside the Workstation without a spreadsheet
- Health score checked ≥1×/week by owner (PostHog HEART)
- Infra cost < $10/firm/mo at ≤20 clients (A6 monitor)

## Spike 1 — AI-drafted bank-feed categorizations (Decision: SPIKE, post-wedge)
Wizard-of-Oz with one firm; measure accept-rate of drafts before building agentic infrastructure. See ASSUMPTIONS A5.

## Pass 1 — Per-seat pricing tier for larger firms
Revisit after wedge pricing data exists; do not pre-commit.
