# Stakeholder Decision Log

*Transparent record of product decisions, trade-offs, and deferred requests. Owned by the Product Owner.*

---

## Decision 001 — Cycle 1 Betting Table: AI Website Assistant

| Field | Detail |
|---|---|
| **Date** | 2026-06-24 |
| **Decision owner** | Product Owner (informed by Product Strategist shaped bet and Tech Lead feasibility review) |
| **Stakeholders consulted** | Product Strategist, Tech Lead, UX Researcher |
| **Decision** | **Run a 1-week spike in Cycle 1.** The full 6-week AI Website Assistant build is **not committed by default**; it will only be folded into Cycle 1 if the spike passes its success criteria and Bet 1/Bet 2 remain on track. Otherwise, the full build moves to Cycle 2. |

### Context

The AI Website Assistant is a strategic differentiator but also the highest-risk item in the Now roadmap. The Tech Lead's feasibility review (R1, R7, SPIKE-004, SPIKE-005) and the shaped bet in `docs/SHAPED_BETS.md` identified guardrail accuracy, prompt-injection resistance, and structured-output reliability as unproven. Building the assistant prematurely could consume capacity needed for the core onboarding flow and expose the product to trust/safety risks.

### Rationale

1. **Critical path first.** Bet 1 (10-Minute Publish Onboarding) is the foundation for every downstream metric. If onboarding does not ship, AI edits have no site to edit.
2. **Risk reduction.** AI assistant guardrails and audit trail are high-impact, high-effort, and high-uncertainty. A spike fits the buffer/debt allocation better than a full build.
3. **Capacity protection.** Committing all three shaped bets (Bet 1: 6 weeks, Bet 2: 3 weeks, Bet 3: 6 weeks) would overload the 8-week cycle and leave no room for CI/toolchain debt, ingestion unknowns, or buffer.
4. **Conditional upside.** If the spike proves the harness quickly, we retain the option to start Bet 3 build stories in week 3 without renegotiating Cycle 1 goals.

### Alternative Considered

Commit all three Now bets (onboarding, live hours, AI assistant) and accept a higher risk of shipping none of them completely. Rejected because it violates the squad's WIP limits and ignores the Tech Lead's explicit risk register (R1, R7).

### Impact

- **Cycle 1 will ship:** onboarding-to-publish flow and live open/closed hours.
- **Cycle 1 will run:** AI assistant guardrail/preview spike (SPIKE-004, SPIKE-005).
- **Cycle 1 will not ship by default:** natural-language AI edits.
- **Cycle 2 bet is conditional:** full AI assistant build only proceeds if spike success criteria are met (>90% schema conformance, 0 unauthorized actions in red-team tests) and Bet 1/Bet 2 remain on track.

### Next Review

Week 2 go/no-go review for AI spike; mid-cycle review (week 4) for overall capacity; end-of-cycle review (week 8) to finalize Cycle 2 bets.

---

## Decision 002 — Cycle 1: No Subscription Billing, Custom Domains, Multi-Location, Catering, or Advanced Analytics

| Field | Detail |
|---|---|
| **Date** | 2026-06-24 |
| **Decision owner** | Product Owner |
| **Stakeholders consulted** | Product Strategist, Tech Lead |
| **Decision** | Keep subscription billing, custom domain support, multi-location support, catering lead capture, and advanced analytics out of Cycle 1. Maintain data-model stubs only. |

### Rationale

These are roadmap items in Next/Later. They are not required to prove the core value proposition (10-minute publish) and would add significant infrastructure, compliance, and validation work. The architecture already stubs `billing_status` and `custom_domain` fields so future work is not blocked.

### Impact

- Cycle 1 scope is smaller and safer.
- Monetization experiments and mini-chain features move to Cycle 2+.

---

## Decision 003 — Cycle 1 Release Go/No-Go and Accepted Risks

| Field | Detail |
|---|---|
| **Date** | 2026-06-25 |
| **Decision owner** | Product Owner |
| **Stakeholders consulted** | Tech Lead, DevOps/SRE, Data Analyst, UX Researcher |
| **Decision** | **GO** for Cycle 1 release to production with progressive ring rollout (internal → 1–5% → 10–25% → GA). |

### Context

Cycle 1 code (Bet 1 — onboarding-to-publish, Bet 2 — live hours) has passed CI/CD, security scans, and staging smoke tests. The deployment artifact is ready. The remaining uncertainty is real-world behavior with pilot customers, so the release will be exposed gradually rather than in a big-bang launch.

### Go criteria

All of the following must be true to begin or continue a rollout ring:

1. CI (`test`, `lint`, `typecheck`, `bandit`) is green for the release commit.
2. Security scans show no open CRITICAL/HIGH findings.
3. Staging smoke tests pass for frontend, backend, and migrations.
4. Backend canary analysis shows error rate < 0.1% and p95 latency < 300 ms for at least 30 minutes.
5. No SEV1/SEV2 incidents attributed to the release.
6. Data Analyst confirms metrics dashboards are healthy and event pipelines are flowing.
7. Rollback runbook has been dry-run tested and rollback time is < 15 minutes.
8. Product Owner has approved the release notes and communication plan.

### No-go / halt criteria

Roll back or halt immediately if any of the following occur:

1. 5xx error rate > 0.5% for 5 minutes.
2. API p95 latency > 500 ms for 5 minutes.
3. Public site LCP > 4 s for 5 minutes.
4. Any confirmed tenant-isolation failure.
5. Any verified wrong-hours complaint from a pilot customer.
6. A single deploy consumes > 25% of the monthly error budget.
7. Any open SEV1/SEV2 incident caused by the release.

### Accepted risks

| Risk | Why accepted | Mitigation |
|---|---|---|
| **AI assistant is not customer-facing.** | Spike is incomplete; guardrails and accuracy are unproven. | Kept behind `ai-assistant-spike` flag, internal-only. Full build is the first Cycle 2 commitment. |
| **Ingestion may return incomplete data.** | Real-world GBP/listing quality varies; menu URLs may be PDFs or unstructured. | Manual fallback is always available; ingestion failures do not block publish. |
| **Frontend image optimization warnings.** | `TemplateSelector` uses `<img>` tags, creating 4 ESLint warnings. | Monitor LCP in Ring 1/2; fix during Cycle 2 flag cleanup. |
| **Catering section is static.** | Lead-capture flow needs more validation. | Owners can still display catering info/contact; lead-capture is top Cycle 2 candidate after AI assistant. |
| **Single-location only.** | Multi-location adds data-model and dashboard complexity. | Mini-chain owners are explicitly excluded from pilot; multi-location queued for Cycle 2 shaping. |
| **No billing or custom domains.** | Monetization and DNS work would delay core value validation. | Free pilot only; pricing-sensitivity survey planned for Cycle 2. |
| **Hours depend on owner-entered data.** | No POS integration in Cycle 1. | Mobile editor target <60 seconds per update; special-hours overrides for 14 days. |

### Rollback authority

- **Automated:** `deploy.yml` rolls back on canary-analysis or production smoke-test failure.
- **Manual:** DevOps/SRE or Tech Lead can invoke the rollback runbook; Product Owner must be notified within 15 minutes.
- **Customer communication:** Product Owner handles pilot notifications; support/CSM handles external communication if GA is reached.

### Next Review

- Daily during Ring 0 and Ring 1.
- At each ring-transition gate.
- End-of-Cycle-1 retrospective to feed into Cycle 2 capacity plan.
