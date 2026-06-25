# QA Standards

| Attribute | Value |
|---|---|
| Product | Foodcart SaaS |
| Version | Cycle 1 (Bets 1–3) |
| Author | QA Enablement |
| Date | 2026-06-24 |
| Review cadence | Monthly |

## Philosophy

Quality is owned by the stream-aligned squad. QA Enablement sets the standards, provides templates, and coaches execution; we do not gatekeep. Every change should be validated as close to the code as possible, with fast feedback in CI and clear, actionable signals on failure.

## Coverage Thresholds

| Layer | Metric | Threshold | Enforcement |
|---|---|---|---|
| Backend Cycle 1 modules | Line coverage | ≥ 80% | `tool.coverage.report.fail_under = 80` in `src/backend/pyproject.toml` |
| Frontend unit / component | Line coverage | ≥ 69.2% (ratcheted) | Fail CI if below `coverage/coverage-summary.json` baseline |
| Frontend unit / component | Branch coverage | ≥ 80.06% (ratcheted) | Fail CI if below baseline |
| Frontend unit / component | Function coverage | ≥ 76.88% (ratcheted) | Fail CI if below baseline |
| Diff coverage (all layers) | New / changed lines | ≥ 80% | PR gate; prefer 90% for security-critical changes |

### Ratchet Rules

- The frontend baseline is extracted from `coverage/coverage-summary.json` at the end of each successful `main` build.
- Baselines only move upward. A PR that raises coverage may update the ratchet file; a PR that lowers coverage fails the gate.
- Backend coverage is scoped to Cycle 1 modules so legacy scaffold code does not dilute the metric:
  - `src/app/routers/foodcart/*`
  - `src/app/schemas_foodcart.py`
  - `src/domain/entities.py`
  - `src/domain/services/foodcart.py`
  - `src/infrastructure/models.py`

## Test Pyramid Ratios

Foodcart SaaS Cycle 1 is a FastAPI monolith + Next.js frontend. Use the **monolith pyramid**:

```
        ┌─────────┐
        │   E2E   │  ~5%   → Playwright: core onboarding → publish → view journey
        │  ~5%    │
       ├───────────┤
       │ Integration│ ~15%  → API tests with test DB, Alembic migration tests,
       │   ~15%    │         Pact consumer/provider contract tests
      ├─────────────┤
      │    Unit      │ ~80%  → pytest / Vitest: domain services, schemas,
      │    ~80%     │         hooks, presentational components, value objects
      └─────────────┘
```

### Ratio Guidance

- Aim for the ratio by **test count and execution time**, not by raw file count.
- Unit tests must run in under 2 minutes.
- Integration tests must run in under 5 minutes.
- E2E smoke tests must run in under 10 minutes in CI.

## Contract Testing Requirements

| Requirement | Detail |
|---|---|
| Framework | Pact: consumer tests in frontend, provider verification in backend |
| Consumer artifacts | Stored in `src/frontend/pacts/` and uploaded as CI artifacts |
| Provider verification | Runs against a fresh database with provider states for onboarding, published site, and authenticated tenant |
| Mandatory contracts | `POST /tenants/onboard`, `GET /sites`, `GET /public/sites/{slug}`, `POST /auth/token` |
| Breaking-change policy | A contract change requires both consumer and provider updates in the same PR or a documented compatibility plan |
| CI schedule | Run on every PR, every push to `main`, and weekly on Mondays |

See `pipeline/platform/qa/CONTRACT_TEST_PATTERN.md` for the Foodcart-specific consumer/provider setup.

## E2E Scope

E2E tests prove critical user journeys, not every permutation. Cycle 1 scope:

| Journey | Spec | Environment |
|---|---|---|
| Onboarding → preview → publish → view live site | `src/frontend/e2e/foodcart-journey.spec.ts` | Mocked backend in PR |
| Full journey against real backend/database | `e2e/journey-real.spec.ts` | Staging / pre-release |
| Automated accessibility scan | `e2e/a11y.spec.ts` | Every PR (after legacy auth wiring is reconciled) |

### E2E Rules

- Mock external dependencies (Clerk, LLM, ingestion fetch) in PR smoke tests.
- Use `data-testid` for stable selectors; prefer user-centric queries (`getByRole`, `getByLabel`) over CSS selectors.
- Keep E2E specs independent; do not share state between specs.
- Run with `retries: 2` in CI only; zero retries locally during debugging.

## Flaky-Test Policy

Flaky tests are treated as **P1 bugs**. A flaky test is any test that fails non-deterministically across runs without a code change.

### Response

1. **Stop the bleed**: if a test flakes in CI, the engineer who owns the change investigates immediately.
2. **Log before fixing**: add an entry to `tests/FLAKINESS_LOG.md` with symptom, frequency, environment, root cause, and mitigation.
3. **Fix first**: stabilization (deterministic fixtures, waits, idempotency) is the default action.
4. **Quarantine last resort**: only after two failed stabilization attempts and approval from the SDET + Tech Lead. Quarantined tests live in `tests/quarantine/` and are run separately, not blocking PRs.
5. **Time-box**: no flaky test may remain in the main suite for more than 48 hours without a logged plan.

See `docs/FLAKINESS_PLAYBOOK.md` for the full triage and quarantine process.

## Mutation Testing & Coverage Policies

- Mutation testing is recommended for backend domain services once Cycle 1 ships; target a mutation score ≥ 70% for `domain/services/foodcart.py`.
- Coverage alone does not guarantee quality: every PR must include assertions that validate behavior, not just execute lines.
- Exclude generated code, migrations, and pure configuration from coverage targets.

## Definition of Done

A story or task is "done" when:

1. Unit tests cover new/changed domain logic and meet the coverage thresholds.
2. Integration tests cover new API contracts and database paths.
3. E2E smoke tests cover the changed journey if it touches onboarding, publish, or public site rendering.
4. Contract tests are updated if the API surface changed.
5. `tests/FLAKINESS_LOG.md` is updated if any test exhibited flakiness during development.
6. All CI quality gates pass (lint, type check, tests, security scans, accessibility checks).
7. Security-critical paths (tenant isolation, AI guardrails, SSRF, XSS) include adversarial tests.
8. Diff coverage is ≥ 80%.

## Cycle 1 Maturity Assessment

| Dimension | Target | Current | Status |
|---|---|---|---|
| Backend unit coverage | ≥ 80% | 95.10% | ✅ Meets |
| Frontend unit coverage | Ratcheted baseline | Lines 69.2%, Branches 80.06%, Functions 76.88% | ✅ Meets |
| Contract tests | Consumer + provider green | Consumer 4 passed, provider 1 passed | ✅ Meets |
| E2E critical journey | Green | `foodcart-journey.spec.ts` passed | ✅ Meets |
| Tenant isolation tests | Comprehensive cross-tenant regression | `test_tenant_isolation_extended.py` covers sites, content, ingestion, revisions, AI, RBAC | ✅ Meets |
| AI guardrail tests | Out-of-scope refusals + apply-flow guardrails | `test_ai_guardrails.py` + `test_security.py` adversarial cases | ✅ Meets |
| Flakiness | Zero flaky tests in Cycle 1 scope | 0 flaky; 4 legacy E2E specs logged as known non-regressions | ✅ Meets |
| Lint / type check | Green | Backend lint and typecheck failed in latest CI feedback | ⚠️ Needs squad follow-up |

### Maturity Notes

- **Testing posture is strong for Cycle 1**: the squad has exceeded backend coverage targets, met frontend ratchets, and built focused security and isolation regression suites.
- **Two high-risk security gaps are documented by tests**: `REM-001` (URL scheme injection) and `REM-002` (SSRF via HTTP redirects). These are tracked as open remediation items, not testing gaps.
- **Code-quality gates need attention**: backend lint and typecheck failures are not testing failures, but they block the CI/CD exit criteria. QA Enablement recommends the backend squad resolve these before declaring the `ci_cd` gate complete.
- **Legacy E2E specs** (`a11y`, `dashboard`, `journey-real`) pre-date the Foodcart scaffold and are logged as known non-regressions. They should be reconciled or removed in Cycle 2.

## References

- `docs/TEST_STRATEGY.md`
- `docs/FLAKINESS_PLAYBOOK.md`
- `tests/FLAKINESS_LOG.md`
- `pipeline/platform/qa/`
