# Workflow: RFC & ADR

## Purpose

Make significant technical decisions explicit, reversible, and reviewable. Lightweight for RFCs; durable for ADRs.

## Trigger

- A shaped bet requires a significant technical choice.
- Any change with cross-team impact or irreversible consequences.

## Participants

- Tech Lead (lead)
- Frontend Engineer, Backend Engineer, DevOps/SRE, Security Champion as needed
- TPM for cross-team dependencies
- AppSec Engineering for security-sensitive RFCs
- Platform Engineer for platform/Golden Path impacts

## Steps

1. **Determine need**
   - Tech Lead decides if RFC is required (cross-team, irreversible, risky).
   - Routine changes skip RFC and go straight to PR.

2. **Write RFC**
   - Use `pipeline/templates/rfc.md`.
   - Include: problem, proposed solution, alternatives, risks, rollback plan.
   - Time-box: 3–5 business days for review.

3. **Review RFC**
   - Distribute to relevant agents.
   - Collect comments and iterate.
   - Tech Lead makes the decision, escalating to the Product Owner when product trade-offs are involved.

4. **Write ADR**
   - For accepted decisions, create `docs/adr/NNNN-title.md` using the template.
   - Status: Proposed → Accepted → Deprecated/Superseded.

5. **Update OpenAPI spec**
   - If the RFC affects APIs, update `openapi.yaml`.

## Exit criteria

- RFC approved or rejected
- ADR created for accepted irreversible decisions
- `openapi.yaml` updated if applicable
- Dependency map updated by Tech Lead (technical dependencies)
- Cross-team dependency board updated by TPM

## Frequency

As needed per initiative.
