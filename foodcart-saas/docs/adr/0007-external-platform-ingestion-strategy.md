# ADR 0007: External Platform Ingestion Strategy

| Field | Value |
|---|---|
| Status | Accepted |
| Date | 2026-06-24 |
| Author | Tech Lead |
| Deciders | Product Strategist, Backend Engineer, Security Champion |

## Context

The 10-Minute Publish Onboarding bet depends on importing data owners already maintain externally: Google Business Profile, Yelp, delivery-platform links, social links, and menu URLs. We need a strategy that reduces friction without violating platform terms, blocking onboarding, or producing misleading content.

## Decision

We will build an adapter-based ingestion layer inside the modular monolith:

1. **Anti-corruption adapters** for Google Business Profile, Yelp Fusion, menu URLs, and social/order links.
2. **Source priority:** GBP primary, Yelp secondary, menu URL third, manual links as opaque URLs.
3. **Async `IngestionJob` records** queued in Redis; each job fetches raw data, caches it, normalizes to content-block proposals, and records errors.
4. **Owner approval** before any normalized proposal overwrites site content.
5. **Graceful degradation:** every field has a manual fallback; failed jobs do not block onboarding.
6. **No bi-directional sync:** we read once during onboarding/retry; ongoing edits happen in Foodcart.
7. **PDF/image menu extraction explicitly out of scope** for Cycle 1.

## Consequences

### Positive

- Anti-corruption layers isolate platform churn from core domain logic.
- Async jobs keep onboarding responsive and resilient to slow APIs.
- Owner approval protects against low-quality imports.
- Manual fallback preserves the "publish now, fix later" path.

### Negative

- Adds operational dependency on external API credentials and quotas.
- Imported data may still be incomplete or outdated.
- Caching raw payloads increases storage and privacy surface.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Screen scraping | Fragile and violates terms of service. |
| Bi-directional sync | Out of scope and increases API permission risk. |
| Deep PDF/image menu extraction | Too complex for Cycle 1; deferred. |
| Manual-only onboarding | Removes core value proposition; used as fallback. |

## Related

- RFC 0004: External Platform Ingestion Strategy
- ADR 0002: Domain Boundaries and Bounded Contexts
- `docs/TECHNICAL_RISK_REGISTER.md` (R2, R4, R14, R18)
- SPIKE-002
