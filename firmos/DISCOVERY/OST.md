# Opportunity Solution Tree

*Outcomes → Opportunities → Solutions → Experiments*

## Business Outcome
Grow to 50 paying bookkeeping firms (~$25k MRR at wedge pricing) within 12 months of launch.

## North Star Metric
**Weekly Active Work Items Completed** — work items (bank-feed weeks, reconciliation months, reports, tasks) marked complete inside FirmOS per firm per week. Proxy for "the firm runs on us."

## Outcome 1: Firm owners trust nothing is slipping
### Opportunity 1.1 — "I find out something was due when the client calls" (evidence: Yecny overdue/due-soon job design; Financial Cents marketing copy targets identical fear)
- **Solution:** Workstation v1 unified queue, pre-attributed to accounting month
- **Experiment:** concierge calendar run for 1 design-partner firm; measure misses before/after

### Opportunity 1.2 — New/behind clients show a wall of false overdues (evidence: Yecny built `catch-up date` specifically for this)
- **Solution:** catch-up dates + deferred-until as first-class fields in the engine
- **Experiment:** demo A/B in interviews: with vs. without catch-up handling; measure perceived accuracy

## Outcome 2: Staff know exactly what to do next
### Opportunity 2.1 — Work scattered across spreadsheets, QBO, email, and PM tools (evidence: Financial Cents "10+ apps consolidated" claim; Uncat adoption)
- **Solution:** materialized work items from recurring rules (daily Inngest job)
- **Experiment:** time-to-find-next-task test with 3 bookkeepers vs. current stack

### Opportunity 2.2 — Chasing clients for documents/statements (evidence: Uncat $9/client/mo success; Content Snare exists solely for this)
- **Solution:** client portal slice with waiting-on-you view + auto review-task on upload
- **Experiment:** fake-door portal in design-partner onboarding; measure upload latency vs. email

## Outcome 3: Owner sees firm health at a glance
### Opportunity 3.1 — No single health number per client (evidence: Yecny client-health scoring built and used daily; Karbon/FC report on utilization, not delivery risk)
- **Solution:** client health score (category completion − overdue penalty) + owner dashboard
- **Experiment:** show scorecard mock to 5 owners; track "would you check this weekly?"

## Outcome 4: The firm's revenue follows its work (Phase 2+)
### Opportunity 4.1 — Invoicing disconnected from work actually done (evidence: Yecny template × billable-completion invoice job)
- **Solution:** invoicing-from-actuals (POST-MVP)
- **Experiment:** interview pricing workflows; quantify reconciliation time between PM tool and QBO invoices
