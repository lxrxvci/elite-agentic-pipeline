# ADR-0009: Canonical contacts before client conversion

**Status:** Implemented locally; private-review release gate remains

## Context

The 2026-11-18 transcript requires one person record across abandoned intakes, converted clients, owners, CPAs, referrals, and additional contacts. Previously only conversion reliably linked database contacts, and editing a selected contact’s name discarded its ID. Association dropdowns also offered every client instead of only businesses already associated with that person.

## Decision

1. Add `intake_contact_links` with intake/contact/role/source/timestamps and a unique intake/contact/role key. Autosave and Continue persist all entered contacts before conversion and return canonical IDs to the live wizard.
2. Prefer explicit canonical IDs. Name plus normalized email remains the fallback identity match; name-only collisions never merge people. Repeated saves use the same links and update the same contact. Multiple roles on one intake reuse the canonical values, so an unchanged owner copy cannot undo a main-contact edit.
3. Keep CPA in its own role and intake card. Referral contact links do not populate or overwrite the CPA record. Conversion consumes those links and only creates client associations and work.
4. The main email is full width and the phone follows below it. Additional channels stack vertically. Multi-select business names use the shared vertical selected list rather than crowding the input.
5. Association options come from `contact_client_links` for the selected contact. New contacts receive no options and no add-business action. Adding an association belongs on the other client record, followed by resuming the intake.
6. `/contacts/[id]` is staff-only and shows canonical channels, client roles, intake statuses, progress, dates, and authorized resume links. The contacts directory remains read-only and links to this history.

## Consequences

- Abandoning an intake does not strand contact data until conversion or require re-entering it.
- Changing a selected record edits that record rather than silently creating another person.
- Existing intakes without the new relation retain their previous name-plus-email conversion fallback.
- Production deployment and migration are separate from this local implementation and require release approval.
