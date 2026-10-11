# Workflow: critique

Independent review stage between `rfc_adr` and `design_build`. The artifact under review is the RFC/design declaration that build will execute against.

## Why it exists

Errors caught in a spec cost minutes. The same errors caught in production cost days. A different-perspective reviewer with a validation rule is cheap insurance with a provable payoff.

## Steps

1. critique_reviewer (never the author) reads the artifact and returns a numbered, severity-tagged issue list.
2. The author answers each issue: accept with a fix, or rebut with evidence.
3. Owner sees the issue list plus dispositions and approves, revises, or rejects the artifact.
4. Accepted fixes land in the artifact before `design_build` opens.

## Rules

- Findings are hypotheses. Each gets a contradiction check plus an evidence check before adoption.
- Cap passes at 2-3 per artifact. Then build; the gates verify the rest.
- One batched review card per cycle, per-item approve/revert, small review budget. No rubber-stamp bundles.
