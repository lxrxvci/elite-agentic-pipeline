# ADR-0010: Institution rename and merge

**Status:** Implemented locally; private-review release gate remains

## Context

Institution dropdown entries become canonical account foreign keys, while older accounts retain institution text. Institution-keyed SOPs can also overlap when two bank names turn out to describe the same institution. The 2026-11-18 transcript assigns correction and consolidation to Admin, not intake pencils.

## Decision

1. `/admin/institutions` is owner/admin-only. Renaming to an existing normalized institution name requires a merge preview and confirmation. A unique new name is a rename.
2. Preview counts affected clients, canonical and legacy-text accounts, and active SOPs before any write. Every overlapping source/target SOP pair requires the administrator to select which procedure remains active.
3. One transaction updates `accounts.institution_id` and legacy `accounts.institution`, active SOP institution keys, recurring-work SOP links, client manual links, vendor assignment links, catalog metadata, and saved intake account snapshots. The source institution is removed only after reassignment.
4. The unselected overlapping SOP becomes inactive rather than deleted. Its content and linked media history remain available, while its active work links move to the retained SOP. The selected procedure keeps its own content and identity.
5. Record an institution rename/merge audit event in the same transaction. A failed reassignment or audit insert rolls back the entire operation.

## Consequences

- Account and procedure references converge without creating another institution list.
- Client-specific manual content is not replaced by shared SOP text.
- Merge choices are explicit and reviewable; no heuristic selects a winning procedure.
- Local tests exercise preview, retention choices, legacy text, saved snapshots, link reassignment, and rollback. Production remains paused pending review and release approval.
