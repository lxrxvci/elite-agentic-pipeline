# Program Risk Register

| Attribute | Value |
|---|---|
| Product | Foodcart SaaS |
| Version | 0.3.0-rfc_adr |
| Author | TPM |
| Date | 2026-06-24 |
| Review cadence | Weekly during Cycle 1; bi-weekly in steady state |

> This register covers **cross-team, program-level, and coordination risks**. Technical risks are owned by the Tech Lead in `docs/TECHNICAL_RISK_REGISTER.md`.

---

## Risk Scoring

| Rating | Likelihood | Impact |
|---|---|---|
| Critical | High | High |
| High | High / Medium | Medium / High |
| Medium | Medium | Medium |
| Low | Low | Low / Medium |

---

## Active Program Risks

| ID | Risk | Area | Likelihood | Impact | Rating | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| **PR-01** | Cycle 1 scope expands to include deferred bets (catering, custom domains, billing) before onboarding is proven. | Scope / Sequencing | Medium | High | High | Enforce shaped-bet appetite; PO gate on scope changes; weekly scope-review checkpoint; tie every request to Cycle 1 acceptance criteria. | TPM / Product Owner | Open |
| **PR-02** | Spike results (SPIKE-002, SPIKE-003) arrive too late, compressing Bet 1 build time. | Schedule | Medium | High | High | Run spikes in parallel with Bet 1 groundwork; hard deadline end of Week 2; if spike fails, fallback scope is pre-defined. | TPM / Tech Lead | Open |
| **PR-03** | Pilot-owner recruiting for onboarding tests falls through, leaving success criteria unmeasured. | Validation | Medium | High | High | Start recruiting in Week 3; build backup pool of 8–10 owners; internal proxy tests as fallback; partner with sales/community leads. | UX Researcher / TPM | Open |
| **PR-04** | External data ingestion (Google/Yelp) raises TOS, privacy, or right-to-use concerns that delay launch. | Legal / Compliance | Low | High | Medium | Confirm user-provided-link model; document data provenance; deletable raw payloads; schedule legal review by Week 3. | TPM / Product Owner | Open |
| **PR-05** | LLM provider budget/cost ceiling not approved before Bet 3 build, forcing scope cut. | Budget | Medium | Medium | Medium | Spike budget pre-approved; production budget request prepared with SPIKE-001 cost forecast; define cost guardrails per tenant. | TPM / Product Owner | Open |
| **PR-06** | Cross-team coordination overhead (platform, security, UX) consumes too much engineering flow time. | Process | Medium | Medium | Medium | Async written updates by default; batch review requests; protect no-meeting blocks; use RFC/ADR comments instead of meetings. | TPM | Open |
| **PR-07** | Bet 2 (Live Hours) starts before Bet 1 content-block schema is stable, causing rework. | Sequencing | Medium | Medium | Medium | Sequence Bet 2 to start Week 3; define schema interface contract; hold joint frontend/backend schema review before Week 3. | TPM / Tech Lead | Open |
| **PR-08** | Security review of AI assistant harness or tenant isolation is bottlenecked by Security Champion availability. | Security / Coordination | Low | High | Medium | Engage Security Champion at start of spike; provide ADR 0003 and threat model early; schedule red-team review by Week 2. | TPM / Security Champion | Open |
| **PR-09** | Vercel / hosting provider changes pricing, limits, or features that affect subdomain routing or cost model. | Vendor | Low | Medium | Low | Maintain alternative-host evaluation (Cloudflare for SaaS, fly.io); keep infrastructure as code portable. | DevOps | Open |
| **PR-10** | Key personnel (Tech Lead, frontend/backend lead) unavailable during Cycle 1 critical path. | Resource | Low | High | Medium | Document decisions in ADRs/RFCs; pair juniors with seniors; identify backup owners for each bounded context. | TPM / Engineering Manager | Open |

---

## Cross-Reference to Technical Risks

| Program risk | Related technical risks (in `docs/TECHNICAL_RISK_REGISTER.md`) |
|---|---|
| PR-02 (late spikes) | R2 ingestion fragility, R11 slug collision, R14 misleading content |
| PR-03 (pilot recruiting) | R9 template CWV, R13 AI UX rejection, R14 ingestion trust |
| PR-04 (data TOS) | R2 ingestion fragility, R14 misleading content |
| PR-05 (LLM budget) | R1 incorrect LLM output, R7 prompt injection, R8 LLM latency |
| PR-07 (schema stability) | R12 timezone/DST, R9 template drift |
| PR-08 (security review bottleneck) | R3 cross-tenant leakage, R7 prompt injection |

---

## Risk Burn-Down Plan

| Week | Action | Owner | Reduces risk |
|---|---|---|---|
| 1 | Confirm Google Business Profile / Yelp API access; set Clerk prod project; reserve Vercel wildcard DNS. | Tech Lead + TPM | PR-02, PR-04 |
| 1 | Issue spike budget approval; prepare production LLM budget memo. | TPM + Product Owner | PR-05 |
| 2 | SPIKE-002/003 decision gates; define fallback onboarding scope. | Tech Lead + Product Owner | PR-01, PR-02 |
| 2 | Schedule Security Champion review of AI harness and tenant isolation. | TPM + Security Champion | PR-08 |
| 3 | Begin pilot-owner recruiting; lock content-block schema contract for Bet 2. | UX Researcher + Tech Lead | PR-03, PR-07 |
| 3 | Legal review of external data ingestion TOS. | TPM + Product Owner | PR-04 |
| 5 | Bet 2 complete; validate hours accuracy with pilot owners. | Tech Lead + UX Researcher | PR-07 |
| 6 | Bet 3 build/no-build decision; finalize production budget. | Product Owner + TPM | PR-01, PR-05 |
| 6–7 | Run onboarding task-based tests; measure time-to-publish and brand-match rating. | UX Researcher | PR-03 |
| 8 | Cycle 1 retrospective; update risk register for Cycle 2. | TPM | All |

---

## Watch List

- Vendor pricing or policy changes for Clerk, Vercel, OpenAI/Anthropic, or Cloudflare R2.
- Google Business Profile API policy changes for mobile food vendors/trucks.
- Availability of pilot owners during summer/peak food-cart season.
- Team capacity changes (PTO, onboarding new hires) during Cycle 1.

---

## Recently Closed

None yet.

---

## Last updated

2026-06-24 — created during RFC & ADR stage for Cycle 1 planning.
