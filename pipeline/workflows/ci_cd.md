# Workflow: CI/CD

## Purpose

Provide fast, reliable feedback and safely move code from commit to production-ready artifact.

## Trigger

- Every push and pull request.

## Participants

- DevOps/SRE (lead)
- SDET
- Platform Engineer (reusable workflow templates)
- AppSec Engineering (security scanning templates)
- QA Enablement (quality standards and coverage policies)
- All engineers

## Pipeline stages

### Commit stage (<5 min)
- Lint, format, type check
- Fast unit tests
- Secret scanning

### PR stage (<15 min)
- Full integration/contract tests
- E2E smoke tests (5–15 tests)
- SAST/SCA security scans
- Diff coverage check (≥80%)
- Dependency vulnerability check

### Pre-merge stage (~30 min)
- Full E2E regression
- Visual regression
- Performance baseline
- Cross-browser tests

### Post-deploy stage (continuous)
- Synthetic smoke tests
- Real user monitoring
- SLO validation
- Automated rollback on anomaly

## Rules

- Pipeline is code; changes are reviewed.
- Fail fast: run fastest checks first.
- Use ephemeral per-PR environments where feasible.
- Every merge to main must be releasable.

## Exit criteria

- All required stages pass
- Artifacts signed and stored
- Deployment candidate tagged

## Frequency

Every commit, continuously.
