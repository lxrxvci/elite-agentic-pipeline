# RFC 0004: Ingestion Strategy for External Platforms

| Field | Value |
|---|---|
| Status | Proposed |
| Date | 2026-06-24 |
| Author | Tech Lead |

## Summary

Propose an adapter-based ingestion strategy that imports public business data from Google Business Profile, Yelp, menu URLs, and social/order links during onboarding, while keeping graceful manual fallback and owner approval at the center of the experience.

## Problem

The core wedge of Foodcart SaaS is reducing the time to a published site. Owners already maintain Google Business Profile, Yelp, delivery-platform links, and social profiles. Pulling that data in automatically is high value, but each source has different API policies, rate limits, data completeness, and fragility. We need a strategy that is reliable, policy-safe, and does not block onboarding when a source fails.

## Proposed solution

1. **Adapter pattern in the Ingestion context.**
   - Each external source has an anti-corruption adapter: Google Business Profile, Yelp Fusion, Menu URL, and a generic link adapter for social/order URLs.
   - Adapters translate source-specific payloads into a common normalized proposal format that conforms to the content-block schema.

2. **Source priority for Cycle 1.**
   1. **Google Business Profile** (OAuth or Places API) — primary source for name, address, phone, hours, photos.
   2. **Yelp Fusion** — secondary source for rating, photos, hours, address.
   3. **Menu URL** — lightweight structured HTML parser; PDF/image extraction explicitly out of scope.
   4. **Manual links** — owner-provided social and delivery-platform URLs stored as opaque strings.

3. **Async, idempotent jobs.**
   - Each source becomes an `IngestionJob` queued in Redis.
   - Jobs fetch raw payloads, cache them, normalize data, and record errors per source.
   - A failed job does not block onboarding; the owner can publish with manual data and retry the source later.

4. **Owner approval before overwrite.**
   - Ingestion produces proposals, not direct mutations.
   - The onboarding dashboard surfaces proposals for owner review.
   - Owner taps to accept, edit, or ignore each proposal.

5. **Graceful degradation.**
   - Every field has a manual fallback.
   - Delivery and social links are stored as opaque URLs; if the platform changes, the owner updates the link in the admin dashboard.

6. **No bi-directional sync.**
   - We read from external platforms during onboarding and ingestion retries only.
   - All ongoing edits happen in the Foodcart dashboard.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Screen scraping all platforms | Fragile, violates terms of service, and hard to maintain. |
| Bi-directional sync back to Google/Yelp | Out of scope for Cycle 1 and increases API permission risk. |
| Deep PDF/image menu extraction | High complexity; deferred to a later spike. Manual paste-to-menu parser is sufficient for MVP. |
| Manual-only onboarding | Removes the "10-minute publish" value proposition; used only as fallback. |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| API rate limits or policy changes | Cache raw payloads, monitor ingestion health metrics, alert on failures, manual override always available. |
| Incomplete or misleading first-pass content | Confidence scoring per source, owner preview/approval before publish, manual fallback, visible job status. |
| Menu URL is a PDF or unstructured image | Explicitly out of scope for Cycle 1; UI prompts owner to paste or manually enter menu items. |
| Google Business Profile data poor for mobile food carts | SPIKE-002 validates real-world coverage before build. |
| Stale imported data after onboarding | Edits happen in Foodcart; re-ingestion is opt-in and owner-approved. |
| Third-party platform link rot | Store links as opaque URLs; periodic health checks; owner can update from admin. |

## Rollback plan

- Re-run ingestion from cached raw payloads.
- Replace generated blocks from a revision snapshot.
- Disable a failing ingestion source behind a feature flag without blocking onboarding.

## Dependencies

- SPIKE-002: ingestion feasibility for GBP/Yelp/menu URLs.
- Google Business Profile / Places API credentials and quota.
- Yelp Fusion API credentials.
- Redis-backed job queue.
- Object store (R2/S3) for imported photos.
- Content block schema (RFC 0002 / ADR 0006).
- Clerk webhook for user/tenant provisioning.

## Timeline

Cycle 1, Bet 1. Core to the 10-Minute Publish Onboarding bet. Build after subdomain routing and content-block schema foundations are in place.
