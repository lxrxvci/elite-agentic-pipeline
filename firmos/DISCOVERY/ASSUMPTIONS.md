# Riskiest Assumptions

Ranked by (impact × uncertainty). Evidence sources: Yecny production data (one firm, 2024–26), competitor research Aug 2026 (Karbon, Financial Cents, TaxDome, Uncat, Double/Keeper), Jason Staats public app commentary.

## A1 — Firms will pay per-client for an operating engine, not per-seat for collaboration (impact: HIGH / uncertainty: HIGH)
- **Assumption:** 1–20 person firms will adopt a $9–$19/client/mo tool with unlimited seats because it replaces 2–4 point tools (Uncat $9/client, Content Snare, spreadsheet trackers).
- **Why it might fail:** incumbents discount per-seat pricing; firms are tool-fatigued (Financial Cents claims "10+ apps consolidated" — same pitch).
- **Validation experiment:** 5 problem interviews with firm owners; pre-sell 3 design-partner slots at $99/mo flat for first 10 clients.
- **Status:** UNVALIDATED — top risk.

## A2 — Accounting-month attribution is the differentiating pain (impact: HIGH / uncertainty: MEDIUM)
- **Assumption:** "Which month does this belong to?" confusion and false-overdue walls are a top-3 firm pain; incumbents only track calendar deadlines.
- **Evidence:** Yecny's handoff states "Most subtle bugs in this system trace back to two pieces of code disagreeing about which accounting month a thing belongs to" — the firm built an entire engine for this. No competitor advertises the concept.
- **Validation experiment:** in interviews, ask owners how they handle mid-month onboarding and close-tier cutoffs; measure emotional intensity vs. other pains.
- **Status:** PARTIALLY VALIDATED (one firm, n=1).

## A3 — The Workstation unified-queue wedge delivers standalone value without billing/payroll (impact: HIGH / uncertainty: MEDIUM)
- **Assumption:** queue + materialization + notifications alone retain firms, before invoicing/commission payroll arrive.
- **Risk:** Jetpack Workflow already covers deadline checklists cheaply; wedge must beat it on attribution + portal, not just checklists.
- **Validation experiment:** concierge MVP — run one firm's work calendar through the engine manually for 2 weeks; measure time saved vs. current tool.
- **Status:** UNVALIDATED.

## A4 — Porting Yecny's Python rules to TypeScript preserves correctness (impact: HIGH / uncertainty: LOW-MEDIUM)
- **Assumption:** `attribution.py` + interval math + health scoring translate losslessly; the 240-test suite pins the semantics.
- **Mitigation:** translate tests FIRST (gate G3 in plan); differential-test TS output against Python originals on fixtures from production pg_dump.
- **Status:** ENGINEERING RISK — mitigated by test-first gate.

## A5 — AI-drafted work items (agent workforce) increase rather than erode trust (impact: MEDIUM / uncertainty: HIGH)
- **Assumption:** firms accept AI drafts with human approval, and approval telemetry feeding on-time metrics feels fair to staff.
- **Evidence:** incumbents ship assistants (Kai, FC AI) but none execute work items; Uncat proves the ask-the-client pattern works for ambiguous transactions.
- **Validation experiment:** fake-door + Wizard-of-Oz on 5 categorization drafts per firm; measure accept-rate and staff sentiment.
- **Status:** UNVALIDATED — differentiator, not wedge; do not block MVP on it.

## A6 — Vercel/Neon/Inngest stack stays economical at wedge pricing (impact: MEDIUM / uncertainty: LOW)
- **Assumption:** infra cost per firm < $10/mo at ≤20 clients/firm (Neon branching, Inngest free tier, Blob, Resend).
- **Mitigation:** cost dashboard from day 1 (pipeline METRICS.md); Upstash/Neon serverless scale-to-zero.
- **Status:** ASSUMED SAFE — monitor from first deploy.
