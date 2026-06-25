# Flakiness Playbook

*Owned by the SDET; standards and escalation policy owned by QA Enablement.*

## Purpose

Provide a repeatable, fast process for identifying, triaging, and eliminating flaky tests. Flaky tests destroy trust in CI and slow the squad down. Treat them as P1 bugs.

## Triage Steps

When a test fails in CI and you suspect flakiness:

1. **Preserve evidence**
   - Capture the failing run URL, job logs, and any artifacts (screenshots, traces, coverage reports).
   - Note the branch, commit SHA, environment, and whether the failure reproduced locally.

2. **Reproduce locally**
   - Run the test in isolation: `pytest path/to/test.py::test_name -v` or `npx playwright test spec.ts --repeat-each=10`.
   - Run the full suite: some flakes only appear with ordering effects.
   - Run with the same seed / worker count / database as CI.

3. **Classify the cause**
   - Use the checklist in [Common Causes and Fixes](#common-causes-and-fixes).
   - If the cause is unclear after 30 minutes, pair with the SDET.

4. **Log it**
   - Add an entry to `tests/FLAKINESS_LOG.md` before attempting a fix.
   - Include: test name, symptom, environment, frequency, root cause, mitigation, owner.

5. **Fix or quarantine**
   - Default: fix the test.
   - Only quarantine after two failed stabilization attempts and SDET + Tech Lead approval.

6. **Verify the fix**
   - Run the test 20 times locally or in CI.
   - Ensure no new flakes are introduced elsewhere.

## Quarantine Policy

Quarantine is a last resort. A quarantined test:

- Is moved to `tests/quarantine/` (backend) or `src/frontend/e2e/quarantine/` (frontend).
- Is run on a separate CI schedule (e.g., nightly) but does **not** block PRs.
- Has a linked ticket with acceptance criteria for re-entry to the main suite.
- Is reviewed weekly in squad sync.

### Approval Checklist

- [ ] Two distinct stabilization attempts have been documented.
- [ ] SDET has reviewed and approved quarantine.
- [ ] Tech Lead has reviewed and approved quarantine.
- [ ] A follow-up ticket is created with a target date for re-entry.
- [ ] `tests/FLAKINESS_LOG.md` is updated.

## Common Causes and Fixes

### 1. Shared mutable state

**Symptom**: Tests pass in isolation but fail in the full suite.

**Fix**:
- Use transactional database rollbacks after each test (`db.rollback()` or `transactional_tests`).
- Give each test its own user, tenant, site, and slug.
- Avoid global in-memory caches; reset them in fixtures.

**Foodcart-specific example**: Two onboarding tests using the same `slug` value collide on the unique slug index. Use a unique slug per test or a `faker` / `uuid` helper.

### 2. Timing and asynchrony

**Symptom**: Playwright assertions fail because an element is not ready; API tests fail because async jobs are incomplete.

**Fix**:
- Replace `sleep` with explicit wait conditions (`page.waitForURL`, `expect(...).toBeVisible()`, `wait_for_job_status`).
- Use polling helpers for async backend jobs.
- Increase timeout only as a temporary diagnostic, not a fix.

**Foodcart-specific example**: The public site cache is invalidated asynchronously after publish. Wait for the cache status endpoint or re-fetch with a retry instead of a fixed delay.

### 3. Database contention (SQLite)

**Symptom**: `sqlite3.OperationalError: database is locked` in CI.

**Fix**:
- Use a dedicated test database per parallel worker or process.
- For contract tests, use a separate contract database (`test_contract.db`) with `check_same_thread=False`.
- Avoid long-lived sessions that share a connection with the app under test.

**Foodcart-specific example**: The Pact provider verifier spawns a uvicorn worker; it must use a separate SQLite file from the test process. See `src/backend/tests/contracts/test_foodcart_contract.py`.

### 4. Non-deterministic data

**Symptom**: Tests fail when ordering changes, timestamps differ, or generated IDs vary.

**Fix**:
- Freeze time (`freezegun`, `@testing-library`'s `fakeTimers`).
- Sort collections before asserting.
- Use deterministic IDs in fixtures; avoid asserting on auto-increment values.

**Foodcart-specific example**: Open/closed status tests depend on the current time and tenant timezone. Freeze `datetime.now()` and set the tenant timezone explicitly in fixtures.

### 5. External dependencies

**Symptom**: Tests fail when Clerk, OpenAI, or ingestion HTTP fetches are unavailable or slow.

**Fix**:
- Mock external HTTP calls in unit and integration tests (`responses`, `httpx` transport mocks, Playwright `page.route`).
- Use contract tests to verify shape; use E2E only for full journeys against stable stubs.
- Never call production LLM APIs from CI.

**Foodcart-specific example**: The AI `/propose` endpoint should use a deterministic stub in CI, not the real OpenAI client. The guardrail tests in `test_ai_guardrails.py` rely on the harness, not the model.

### 6. Test ordering and parallel workers

**Symptom**: Flakiness only appears with `pytest -n auto` or Playwright `workers > 1`.

**Fix**:
- Make tests order-independent.
- Use file-based or process-based isolation for shared resources.
- In Playwright, avoid relying on a persisted `localStorage` value from a previous spec.

**Foodcart-specific example**: E2E specs set a fake Clerk token via `localStorage`; ensure each spec sets its own token rather than inheriting state.

### 7. Clock and timezone edge cases

**Symptom**: Open/closed status or hours tests flake near midnight, DST transitions, or tenant timezone boundaries.

**Fix**:
- Parameterize tests across timezone offsets and boundary times.
- Use IANA timezone names (e.g., `America/Los_Angeles`) and a timezone-aware clock.
- Add explicit tests for overnight hours and DST gaps.

## Foodcart-Specific Flakiness Watch List

| Area | Risk | Mitigation |
|---|---|---|
| Tenant slug uniqueness | Collision in parallel tests | Generate unique slugs per test |
| SQLite contract DB lock | Provider verifier shares DB file | Use isolated `test_contract.db` |
| AI LLM stub drift | Real model calls nondeterministic | Always stub LLM client in CI |
| Ingestion HTTP fetch | External sites may timeout or change | Mock `httpx` transport; never hit real URLs |
| Public site cache invalidation | Async after publish | Poll status or retry fetch |
| Hours/timezone computation | Time-of-day dependent tests | Freeze time and parameterize timezones |
| Legacy E2E specs | Deterministically fail on Foodcart scaffold | Logged as known non-regressions; remove/reconcile in Cycle 2 |

## Metrics and Review

- Track flakiness rate: `(flaky failures / total CI runs) × 100`.
- Target: < 0.5% per suite.
- Review `tests/FLAKINESS_LOG.md` weekly in squad sync.
- Re-evaluate quarantined tests monthly; either fix and reintegrate or delete.

## References

- `tests/FLAKINESS_LOG.md`
- `docs/QA_STANDARDS.md`
- `docs/TEST_STRATEGY.md`
