# RFC 0003: AI Assistant Operation Allowlist and Guardrails

| Field | Value |
|---|---|
| Status | Proposed |
| Date | 2026-06-24 |
| Author | Tech Lead |

## Summary

Define the allowed operations, mandatory approval flow, and layered safety controls for the AI Website Assistant so owners can edit their sites conversationally without risking account, billing, auth, or cross-tenant changes.

## Problem

Owners want to update their sites as quickly as they post a social story, but they are afraid of "breaking something" with AI. At the same time, an LLM that can mutate tenant data is a high-risk surface: it can hallucinate content, be manipulated by prompt injection, or be asked to perform destructive actions. We need a deterministic, reversible, tenant-scoped harness.

## Proposed solution

1. **Stateless, schema-bound transformer.**
   - The AI service is stateless. It receives the current site's content blocks, the owner's prompt, and a strict system prompt.
   - The LLM returns a structured `ChangePreview` object (summary, confidence score, in-scope flag, and a list of `PatchOperation`).

2. **Patch operation allowlist.**
   - Each `PatchOperation` targets a path inside the current site's `ContentBlock.data`, e.g., `/blocks/{block_id}/data/headline`.
   - Allowed effects map to content edits only:
     - Hero text, image, and CTA.
     - Menu categories and items.
     - Location hours, address, and phone.
     - Story text.
     - Social and order links.
     - Catering blurb.

3. **Prohibited operations.**
   - Account deletion or modification.
   - Billing or subscription changes.
   - Authentication, role, or Clerk settings.
   - Site slug or custom domain changes.
   - Cross-tenant queries or mutations.
   - Arbitrary code, SQL, shell, or file-system execution.

4. **Explicit approval workflow.**
   - `POST /sites/{site_id}/ai/propose` returns a validated preview.
   - The UI shows a human-readable diff (before / after).
   - `POST /sites/{site_id}/ai/apply` applies the patch only when `confirmed=true`.
   - The backend creates a `Revision` snapshot before applying any change.

5. **Safety controls.**
   - Input sanitization: strip control characters, max 2,000 characters.
   - System prompt hardening: repeat allowlist and prohibited actions.
   - Pydantic v2 output validation; reject unknown fields.
   - Patch-path allowlist: every path must match a known block and field.
   - Per-tenant rate limits stored in Redis (e.g., 100 proposes / 50 applies per day).
   - 30-second LLM timeout with graceful fallback.
   - Circuit breaker: disable AI proposes if error rate > 10% over 5 minutes.
   - Audit logging: prompt hash, model, response hash, user, applied patch, revision.

6. **Spikes gating the build.**
   - SPIKE-004: >90% schema conformance on realistic owner prompts.
   - SPIKE-005: zero unauthorized actions across a 50-prompt red-team exercise.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| LLM agent with open tool-calling | Too broad; harder to sandbox and audit than a fixed allowlist of content patches. |
| Auto-apply "low-risk" changes | Violates the shaped-bet requirement that every AI mutation requires explicit approval. |
| Manual editing only | Removes the key differentiator and retention driver identified in discovery. |
| Single request that proposes and applies | Removes the human-in-the-loop checkpoint; rejected. |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Prompt injection or adversarial use | System prompt hardening, input/output validation, operation allowlist, patch-path validation, red-team spike (SPIKE-005), rate limits. |
| LLM produces incorrect menu items, prices, or hours | Confidence threshold, side-by-side diff, mandatory approval, revision snapshot, manual fallback. |
| Long LLM calls hit serverless timeout | 30-second timeout, streaming propose responses, background queue for ingestion-heavy tasks. |
| Owners reject proposals because scope feels narrow | Clear "out of scope" messaging, human-readable summaries, side-by-side diff, one-click manual fallback. |
| Patch-path allowlist bypass | Path parsing uses strict JSON-Pointer-like segments against known block IDs and field names; no wildcards or traversal. |

## Rollback plan

- Disable the AI assistant feature flag.
- Revert any applied change via the revision system.
- Retain audit logs for incident review.

## Dependencies

- ADR 0003: AI Website Assistant Harness and Guardrails.
- RFC 0002 / ADR 0006: Content Block Schema and Template Engine.
- OpenAI or Anthropic structured-output API.
- Redis for tenant quotas and rate limiting.
- Audit logging and observability pipeline.
- SPIKE-004 and SPIKE-005.

## Timeline

- **Spike:** weeks 1–2 of Cycle 1.
- **Build decision:** end of week 2, contingent on spike success.
- **Build:** 6 weeks if folded into Cycle 1, otherwise start of Cycle 2.
