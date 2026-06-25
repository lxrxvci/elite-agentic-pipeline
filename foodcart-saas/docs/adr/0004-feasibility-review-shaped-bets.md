# ADR 0004: Feasibility Review of Shaped Bets

| Field | Value |
|---|---|
| Status | Proposed |
| Date | 2026-06-24 |
| Author | Tech Lead |
| Deciders | Product Strategist, Product Owner, Tech Lead |

## Context

The product trio has shaped three candidate bets for the next build cycle:

1. **10-Minute Publish Onboarding** — link ingestion + generated preview + publish.
2. **Live Open/Closed + Hours Management** — timezone-aware status and hours editing.
3. **AI Website Assistant with Guardrails** — natural-language editing with mandatory preview/approval.

We need a feasibility decision for each: build, spike, or defer. This ADR records the Tech Lead review and the conditions for moving each bet into the RFC/ADR and build workflows.

## Decision

We will proceed as follows:

| Bet | Decision | Condition / sequencing |
|---|---|---|
| 10-Minute Publish Onboarding | **BUILD** | After SPIKE-002 confirms ≥ 70% credible first-pass data quality from Google Business Profile / Yelp / menu URL ingestion. |
| Live Open/Closed + Hours | **BUILD** | Immediately after the onboarding foundation is in place; low risk, high trust impact. |
| AI Website Assistant with Guardrails | **SPIKE first, then BUILD** | Only after SPIKE-001 (LLM benchmark), SPIKE-004 (change-preview accuracy), and SPIKE-005 (prompt-injection red-team) pass their success criteria. |

## Rationale

### Onboarding — BUILD

- The existing scaffold already supports tenant creation, site slugs, content blocks, and ingestion jobs.
- The core uncertainty is data quality from external sources, not architecture.
- Limiting ingestion to GBP + manual fallback first, then Yelp, then menu URL keeps the blast radius small.
- This bet is the MVP wedge; without it, no other bet delivers value.

### Hours — BUILD

- Pure backend/frontend logic with well-understood timezone libraries.
- No new external dependencies beyond what onboarding already requires.
- High customer trust impact with small engineering appetite (3 weeks).

### AI Assistant — SPIKE first

- The harness architecture is already defined in ADR 0003 and is sound.
- The unknowns are empirical: which LLM gives the best cost/accuracy trade-off, whether structured output reliably conforms to our schema, and how resistant the harness is to prompt injection.
- Building without these spikes risks either poor user experience or runaway LLM costs.

## New technical risks identified

| ID | Risk | Mitigation |
|---|---|---|
| R11 | Slug reservation race conditions or collisions. | Database unique constraint, atomic create-or-reserve, server-side normalization. |
| R12 | Timezone/DST errors in open/closed status. | IANA timezone names, standard libraries, automated DST tests. |
| R13 | Owners reject AI proposals due to narrow scope or unclear diff. | Clear out-of-scope messaging, side-by-side diff, easy manual fallback. |
| R14 | Onboarding ingestion produces misleading first-pass content. | Confidence scoring, owner preview/approval, manual fallback, job status visibility. |

These risks are recorded in `docs/TECHNICAL_RISK_REGISTER.md`.

## Consequences

### Positive

- Focuses the next cycle on the highest-leverage, lowest-risk MVP work.
- Defers segment-specific or monetization bets until the core publish loop is proven.
- Uses spikes to resolve the biggest uncertainty (AI assistant) before committing engineering capacity.

### Negative

- AI assistant ships later than some stakeholders may want.
- If SPIKE-002 fails, onboarding scope must shrink to manual-only setup, reducing the "10-minute" value proposition.
- Multi-location, catering, and custom domains remain unaddressed for at least one more cycle.

## Spikes

- **SPIKE-001**: LLM provider benchmark (OpenAI vs Anthropic).
- **SPIKE-002**: Ingestion feasibility (GBP/Yelp/menu URL).
- **SPIKE-003**: Content block schema validation against all three templates.
- **SPIKE-004**: AI change-preview accuracy (> 90% schema conformance).
- **SPIKE-005**: Prompt-injection red-team.

## Related documents

- `docs/SHAPED_BETS.md`
- `docs/TECHNICAL_RISK_REGISTER.md`
- `docs/DEPENDENCY_MAP.md`
- `docs/adr/0003-ai-assistant-harness.md`
- `ROADMAP.md`
