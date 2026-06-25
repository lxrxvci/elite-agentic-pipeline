# Capacity Plan — Foodcart SaaS

*Cycle 1 capacity allocation for the first build cycle. Informed by the shaped bets in `docs/SHAPED_BETS.md`, the outcome-based roadmap in `ROADMAP.md`, and the technical risk register in `docs/TECHNICAL_RISK_REGISTER.md`.*

---

## Cycle Definition

| Attribute | Value |
|---|---|
| **Cycle** | Cycle 1 — MVP Foundation |
| **Duration** | 8 weeks |
| **Squad size** | 5 full-time engineers (assumed: 2 frontend, 2 backend, 1 full-stack / platform) |
| **Gross capacity** | 5 engineers × 8 weeks = 40 engineer-weeks |
| **Effective capacity** | ~30 engineer-weeks (assumes 25% overhead for meetings, reviews, on-call, and context switching) |
| **Capacity rule applied** | 55–70% features / 15–20% debt & bugs / 10–15% buffer |
| **Plan date** | 2026-06-24 |

---

## Allocation

| Bucket | Share | Capacity | Purpose |
|---|---|---|---|
| **Features (committed bets + spike)** | 70% | ~21 engineer-weeks | Build Bet 1 and Bet 2; run the Bet 3 spike. |
| **Tech debt, quality, bugs** | 15% | ~4.5 engineer-weeks | Fix environment/CI gaps, observability wiring, security hardening, tenant-isolation tests. |
| **Buffer & uncertainty** | 15% | ~4.5 engineer-weeks | Absorb ingestion unknowns, scope discovery, sick/vacation cover, final polish. |
| **Total** | 100% | 30 engineer-weeks | |

---

## Committed Bets — Cycle 1

Shaped-bet appetites are calendar-week bounds. The table below converts them into planned engineering capacity and sequence.

| Bet | Shaped Appetite | Planned Capacity | Subteam | Sequence |
|---|---|---|---|---|
| **Bet 1 — 10-Minute Publish Onboarding** | 6 weeks | ~15 engineer-weeks | 2 frontend + 1 backend | Weeks 1–6 (foundation, wizard, ingestion, templates, admin, preview/publish, validation). |
| **Bet 2 — Live Open/Closed + Hours** | 3 weeks | ~3 engineer-weeks | 1 backend / full-stack | Weeks 3–5 (waits for content-block model from Bet 1, then admin editor + public badge). |
| **Bet 3 — AI Assistant Guardrails** | 1-week spike + conditional 6-week build | ~1 engineer-week spike | Tech Lead + 1 engineer | Weeks 1–2: SPIKE-004 (change-preview accuracy) and SPIKE-005 (prompt-injection resistance). Build decision by end of week 2. |

### Sequencing Rationale

1. **Bet 1 is the critical path.** Without tenant creation, onboarding, content blocks, and publish, no other feature can ship or be measured. It receives the majority of feature capacity.
2. **Bet 2 starts after Bet 1's content model is stable** (week 3). It is low-risk and high-confidence, so it can run in parallel with limited coordination overhead.
3. **Bet 3 spike runs in weeks 1–2.** We will not commit the full 6-week AI build unless the spike demonstrates >90% schema conformance and zero guardrail breaches **and** Bet 1 remains on track to finish by week 6. The default plan is to defer the full AI build to Cycle 2.

---

## Conditional AI Build Decision Tree

| Spike Result | Bet 1 Health | Decision |
|---|---|---|
| SPIKE-004 and SPIKE-005 pass | On track for week 6 | May pull 1 engineer into Bet 3 stories in week 3; accept that full build likely continues into Cycle 2. |
| Spikes pass | At risk or behind | Defer full AI build to Cycle 2; protect Bet 1 success criteria. |
| Spikes fail or are inconclusive | Any | Defer full AI build; run follow-up spike or wait for LLM/provider improvements. |

---

## Debt & Quality Allocation

| Item | Effort | Why Now |
|---|---|---|
| Fix backend test environment (`fastapi`, test deps missing) | ~0.5 wk | Current CI test job fails; blocks reliable build. |
| Fix frontend toolchain install / node_modules drift | ~0.5 wk | Lint/test/typecheck commands fail due to missing binaries. |
| Resolve backend typecheck errors (133 errors) | ~1.0 wk | Required for clean CI gate and maintainability. |
| Add security scan baseline (bandit, semgrep, trivy) | ~0.5 wk | Threat model and risk register require verifiable controls. |
| Tenant-isolation integration tests | ~0.5 wk | Critical for Bet 1 success criteria; prevents R3 leakage. |
| Observability wiring (metrics, traces, structured logs) | ~1.0 wk | Supports SLOs and WASE instrumentation. |
| Setup / deploy local dev env polish | ~0.5 wk | Reduces onboarding friction for new engineers. |

---

## WIP & Flow Rules

- **WIP limit per workflow stage:** `n + 1` = **6 items max** for a 5-person squad. We will keep the active build stage focused on Bet 1, Bet 2, and the Bet 3 spike.
- **No new feature work** enters the build stage after week 5 unless it replaces a completed story.
- **Daily standups** track blockers; **weekly** review throughput and buffer burn.
- **Cycle review at week 8:** demo Bet 1 and Bet 2, review spike outcomes, decide Cycle 2 bets.

---

## Probabilistic Forecast

*We do not have enough historical throughput data for a true Monte Carlo simulation. The forecast below is a judgment-based, appetite-driven probability that the committed scope finishes by the end of the 8-week cycle, assuming no scope creep.*

| Bet | 50% confidence | 70% confidence | 85% confidence |
|---|---|---|---|
| Bet 1 — 10-Minute Publish Onboarding | End of week 6 | End of week 7 | End of week 8 with scope cut (e.g., narrow ingestion to GBP + manual fallback only) |
| Bet 2 — Live Open/Closed + Hours | End of week 5 | End of week 6 | End of week 6 |
| Bet 3 — AI spike | End of week 2 | End of week 2 | End of week 3 |

**How we will improve the forecast:** Track cycle throughput (stories completed per week) from week 1 and recalibrate probabilities at the midpoint review.

---

## Risk & Dependency Buffer

| Risk | Mitigation in Cycle 1 |
|---|---|
| Ingestion sources fail or block scraping (R2) | Prioritize graceful manual fallback; anti-corruption adapter pattern from `docs/ARCHITECTURE.md`. |
| LLM spike does not prove guardrails (R1, R7) | Keep AI build out of Cycle 1 by default; only commit after spike success criteria pass. |
| Tenant isolation gaps (R3) | Integration tests in debt bucket; code-review checklist for every repository change. |
| Reference templates hurt Core Web Vitals (R9) | Lighthouse CI gate in test strategy; lazy-load animations. |
| CI/toolchain failures block merges | First debt items in week 1. |

---

## Stakeholder Commitments

- **We will ship:** a working onboarding-to-publish flow and live hours status by end of Cycle 1.
- **We will run:** a 1–2 week AI assistant guardrail/preview spike with a build/no-build decision by end of week 2.
- **We will not ship in Cycle 1:** full AI assistant edits, subscription billing, custom domains, multi-location support, native checkout, catering lead capture, or advanced analytics.
- **Deferred bet decision log:** see `docs/STAKEHOLDER_DECISION_LOG.md`.

---

## Review Cadence

- **Weekly:** squad capacity burn vs. plan, buffer consumption, blocker escalation.
- **Week 2 go/no-go:** AI spike review + conditional build decision.
- **Mid-cycle (week 4):** reforecast Bet 1 completion; decide whether to pull buffer into scope or cut scope.
- **End of cycle:** retrospective + Cycle 2 capacity plan.
