# ADR 0003: AI Website Assistant Harness and Guardrails

| Field | Value |
|---|---|
| Status | Accepted |
| Date | 2026-06-24 |
| Author | Tech Lead |

## Context

The AI Website Assistant lets business owners type requests like:

- "Add a vegan section to the menu."
- "Change the hero headline to Summer Specials."
- "Update Friday hours to 11pm."

The assistant must propose changes, require explicit approval, and be strictly harnessed. It must never delete accounts, change billing, modify auth, execute arbitrary code, or access other tenants.

## Decision

We will implement the AI assistant as a **stateless, schema-bound transformer** behind a deterministic approval gate. All LLM output is validated against Pydantic schemas and translated into a small, allowlisted set of content mutations. No LLM output is executed directly.

## Harness Design

### 1. Operation Allowlist

The assistant may only perform mutations that map to the Content context block schema:

| Allowed operation | Example |
|---|---|
| Update hero text, image, CTA | "Change headline to Summer Specials" |
| Add/reorder/remove menu categories | "Add a vegan section" |
| Add/edit/remove menu items | "Add falafel wrap $9" |
| Update location hours/address/phone | "Update Friday hours to 11pm" |
| Update story text | "Make the story shorter" |
| Update social/order links | "Add our Instagram" |
| Update catering blurb | "Mention wedding catering" |

**Prohibited operations**

- Account deletion or modification.
- Billing/subscription changes.
- Auth settings, roles, or Clerk integration.
- Site slug changes (may be allowed later with explicit admin flow, but not via AI).
- Cross-tenant queries.
- Arbitrary code, SQL, or shell execution.

### 2. Structured Output Only

The assistant supports multiple LLM backends. The default production provider is **Google Gemini** (model `gemini-2.0-flash` or an environment-specific override). When no API key is configured, the backend falls back to a deterministic local stub. The LLM returns JSON that conforms to one of two Pydantic schemas:

- `ChangePreview`: human-readable summary, list of `PatchOperation`, confidence score, and a flag if the request is out of scope.
- `PatchOperation`: `{ op: "replace" | "add" | "remove", path: "/blocks/{block_id}/...", value: any }`.

Malformed or non-JSON output, provider errors, or schema-validation failures degrade to the deterministic local stub so the user experience remains intact while the incident is logged.

### 3. Explicit Approval Workflow

```
User prompt
    │
    ▼
POST /api/v1/sites/{id}/ai/propose
    │
    ▼
LLM returns ChangePreview
    │
    ▼
UI shows diff (before / after)
    │
    ▼
User clicks Approve
    │
    ▼
POST /api/v1/sites/{id}/ai/apply
    │
    ▼
Backend snapshots current content → Revision
    │
    ▼
Apply allowlisted patch operations
    │
    ▼
Emit AIChangeApplied event
```

A change is never applied in the same request that generated the proposal.

### 4. Tenant Isolation

- The assistant service receives only the current tenant's `site_id` and content.
- Every repository query includes `tenant_id` filtering.
- The prompt never includes other tenants' slugs, names, or content.
- User authentication is enforced by existing `get_current_user` / `get_current_tenant` dependencies.

### 5. Safety Controls

| Control | Implementation |
|---|---|
| Input sanitization | Strip control characters; max prompt length 2,000 chars. |
| System prompt hardening | Strong system prompt that repeats the allowlist and prohibits destructive actions. |
| Output schema validation | Pydantic v2 parsing; reject unknown fields. |
| Patch validation | Each `path` must match a known block and field; values validated by block schema. |
| Rate limiting | Per-tenant daily limit (e.g., 100 proposes, 50 applies). |
| Timeout | 30-second LLM timeout; return graceful fallback to the local stub. |
| Circuit breaker | Degrade to manual editing if LLM error rate > 10% over 5 minutes. |
| Audit logging | Log prompt hash, model, response hash, user_id, applied patch, revision_id. |

### 6. Revertibility

Every applied AI change creates a `Revision` snapshot of the full content before the change. Users can revert from the admin dashboard. Revisions are immutable and retained for at least 90 days.

## Operation Allowlist (Cycle 1)

The assistant may mutate only the following content fields, all inside the current site's `ContentBlock.data`:

| Allowed operation | Example prompt |
|---|---|
| Update hero text, image, or CTA | "Change headline to Summer Specials" |
| Add/reorder/remove menu categories | "Add a vegan section" |
| Add/edit/remove menu items | "Add falafel wrap $9" |
| Update location hours, address, or phone | "Update Friday hours to 11pm" |
| Update story text | "Make the story shorter" |
| Update social or order links | "Add our Instagram" |
| Update catering blurb | "Mention wedding catering" |

Every patch path is validated against the block schema before application.

## Consequences

### Positive

- Strong safety boundaries reduce risk of accidental or malicious changes.
- Human-in-the-loop keeps the user in control.
- Revision snapshots satisfy the "versioned and revertible" requirement.

### Negative

- Adds latency (two API calls + diff rendering).
- Limits free-form creativity; users may be frustrated if a request is rejected.
- Requires ongoing prompt engineering and monitoring.

## Spikes

- **SPIKE-004**: Build a proof-of-concept that takes 10 real menu/hours prompts and produces valid `ChangePreview` objects with >90% schema conformance.
- **SPIKE-005**: Evaluate prompt-injection resistance with a small red-team exercise.

## Related

- RFC 0003: AI Assistant Operation Allowlist and Guardrails
- ADR 0002: Domain Boundaries and Bounded Contexts
- ADR 0006: Content Block Schema and Template Engine
- `docs/TECHNICAL_RISK_REGISTER.md` (R1, R7, R13, R16)
- `docs/SECRETS_MANAGEMENT.md` (LLM API key)
