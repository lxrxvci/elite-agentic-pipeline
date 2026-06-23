# GitHub Actions Platform Templates

This directory contains the canonical GitHub Actions workflow templates used by generated projects.

The `_drift-check.yml` workflow verifies that these templates stay in sync with `example_project/.github/workflows/`. When you update one side, update the other so drift-check stays green.

## Workflow index

- `ci.yml` — lint, type-check, tests, and required status aggregation.
- `security.yml` / `_security-scan.yml` — SAST, dependency review, secrets scanning, CodeQL.
- `contract-tests.yml` — Pact consumer/provider contract verification.
- `deploy.yml` — Vercel-only staging → production deploy with migrations, canary, and auto-rollback.
- `migrate.yml` — manual Alembic migration against staging or production.
- `rollback.yml` — manual Vercel rollback for backend or frontend.
- `chaos.yml` / `load-tests.yml` / `dora-metrics.yml` — game-day, load, and DORA workflows.
