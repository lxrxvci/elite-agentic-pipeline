# RFC 0002: Content Block Schema and Template Engine

| Field | Value |
|---|---|
| Status | Proposed |
| Date | 2026-06-24 |
| Author | Tech Lead |

## Summary

Define a shared, versioned content-block schema and a lightweight frontend template engine so that onboarding, manual edits, AI-assisted edits, and ingestion all operate on the same structured contract.

## Problem

Each generated site must render the seven required sections (hero, story, menu, locations/hours, catering, contact, order links, footer) across three distinct reference templates. Without a stable schema:

- AI and ingestion will produce inconsistent or invalid content.
- Template changes will break existing sites.
- Manual editing and AI patching will require custom logic per template.

## Proposed solution

1. **ContentBlock entity.**
   - `id`, `site_id`, `tenant_id`, `block_type`, `schema_version`, `data` (JSONB), `sort_order`.
   - Stored in PostgreSQL as JSONB for flexibility with ACID guarantees.

2. **Block types (v1).**
   - `hero`
   - `story`
   - `menu`
   - `locations`
   - `catering`
   - `contact`
   - `order_links`
   - `footer`

3. **Schema validation.**
   - Backend validates every block against a versioned JSON Schema using Pydantic v2.
   - Frontend consumes TypeScript types generated from the OpenAPI contract.
   - Unknown fields are rejected; malformed blocks cannot be persisted.

4. **Template engine.**
   - The Next.js consumer app maps `(block_type, template_id)` to a React section component.
   - Template-specific design tokens (colors, fonts, spacing, animations) live in the frontend template package, not in the database.
   - `sort_order` determines section order on the page.

5. **Onboarding generation.**
   - The onboarding flow creates a default set of blocks for the chosen template.
   - Ingestion and AI produce normalized proposals that conform to the same block schemas.

6. **Versioning.**
   - Schema changes in Cycle 1 are additive only.
   - A future breaking change bumps `schema_version` and includes a lazy migration path.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| HTML or rich-text blobs | Flexible for editors, but unsafe, hard to validate, and nearly impossible for an AI to patch reliably. |
| Per-template content schemas | Would let templates diverge, making ingestion and AI logic template-specific and brittle. |
| Full headless CMS (e.g., Sanity, Strapi) | Powerful but adds operational cost and another service; rejected for MVP. |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Schema drift between backend and frontend | OpenAPI is the source of truth; generate TypeScript types; contract tests in CI. |
| Block data does not render correctly in one or more templates | SPIKE-003 validates each block type against all three reference templates before build. |
| Schema versioning becomes painful | Additive-only changes in Cycle 1; version bump reserved for intentional breaking changes. |
| Template engine couples blocks too tightly to React | Block type is a stable contract; only the renderer is framework-specific. |

## Rollback plan

- Content blocks are immutable per revision; any bad mutation can be reverted.
- If a schema version is flawed, older versions remain readable and a migration can convert blocks back.

## Dependencies

- SPIKE-003: validate block schemas against all three reference templates.
- Frontend template components for `banhmi`, `real-indian`, and `mis-abuelos`.
- AI and ingestion contexts (they write blocks).

## Timeline

Cycle 1, Bet 1. The schema must be stable before ingestion and AI development begins.
