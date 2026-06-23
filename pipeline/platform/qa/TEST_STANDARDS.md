# QA Standards

QA Enablement owns standards and tooling; squad SDETs own execution.

## Test pyramid

| Layer | Tool | Owner | Coverage target |
|---|---|---|---|
| Unit | pytest / Vitest | Squad engineers | Backend ≥ 80%, Frontend ≥ 70% |
| Integration | pytest + TestClient | SDET / Backend engineer | All API contracts |
| Contract | Pact | SDET | Frontend ↔ Backend |
| E2E | Playwright | SDET | Critical user journeys |
| Accessibility | axe-core | SDET | WCAG 2.1 AA |
| Performance | k6 | SDET / SRE | SLO thresholds |

## CI gates

1. Lint and type check must pass.
2. Unit and integration tests must pass.
3. Coverage must meet targets.
4. E2E smoke tests must pass.
5. Security scans must pass.
6. Contract tests must pass before release.

## flaky tests

- Flaky tests are treated as P1 bugs.
- Quarantine flaky tests after 3 failures; fix within 48 hours.
