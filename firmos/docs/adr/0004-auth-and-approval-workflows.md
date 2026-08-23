# ADR-0004: Auth via Better Auth with delegated TOTP MFA; approval workflow pattern inherited from Yecny

## Status

Accepted

## Context

Yecny hand-rolled JWT auth (python-jose) with TOTP MFA encrypted under `YB_ENCRYPTION_KEY` — producing its most dangerous standing trap: rotating that key orphans every staff member's MFA secret. FirmOS needs org/team primitives, role-based access (owner/admin/manager/bookkeeper/client), and MFA without inheriting that class of key-management risk. Separately, Yecny proved a valuable governance pattern: irreversible actions go through request → different-approver → apply with append-only audit events.

## Decision

Adopt Better Auth (self-hosted, Postgres-backed) with its organization plugin for firms/teams/invites and built-in TOTP MFA. We do not hold or rotate MFA encryption keys ourselves. Additionally, adopt Yecny's request→apply approval workflow as a first-class application pattern for consequential actions (client purge/reset, plan changes, AI agent work-item application), backed by an append-only `audit_events` table.

## Consequences

Easier: MFA lifecycle delegated; session management, invites, and RBAC out of the box; audit trail satisfies SOC-2 groundwork.
More difficult: Better Auth is younger than Clerk/Auth.js — pin versions and keep the adapter thin so a swap is possible; custom roles map onto its permission model with some translation.

## Alternatives considered

- **Clerk:** fastest to ship, but per-MAU cost at unlimited-seat pricing erodes margin and data lives off-platform; acceptable fallback if Better Auth stalls.
- **Auth.js:** flexible but more assembly required for org primitives.
- **Hand-rolled (Yecny style):** rejected — reproduces exactly the key-trap class we are escaping.

## Related

- ADR-0002 (RLS is the second isolation layer; auth is not), docs/THREAT_MODEL.md
