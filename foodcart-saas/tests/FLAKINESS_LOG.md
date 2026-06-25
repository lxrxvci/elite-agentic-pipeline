# Flakiness Log

*Owned by the SDET. Updated whenever a test exhibits nondeterministic behavior or a known deterministic failure is discovered.*

## Current Status

| Suite | Flaky Tests | Quarantined | Known Non-Regressions |
|---|---|---|---|
| Backend pytest | 0 | 0 | 0 |
| Frontend Vitest | 0 | 0 | 0 |
| Playwright E2E | 0 | 0 | 4 legacy specs outside Cycle 1 scope |
| Pact contracts | 0 | 0 | 0 |

## Active Known Failures

### 2026-06-24 — Legacy E2E specs fail on Foodcart scaffold

Three legacy E2E specs pre-date the Foodcart Cycle 1 scaffold and fail deterministically because the current admin/dashboard routing and auth wiring are Foodcart-specific. They are **not** regressions introduced by Cycle 1 work.

| Spec | Symptom | Root Cause | Mitigation |
|---|---|---|---|
| `e2e/a11y.spec.ts` | Missing `<title>` assertion on `/login` | Login page metadata no longer matches legacy spec expectations after Foodcart layout refactor. | Logged; to be addressed when legacy auth pages are re-integrated or removed. |
| `e2e/dashboard.spec.ts` | Dashboard heading not found | Spec expects legacy dashboard at `/`; Foodcart admin routes to `/admin`. | Logged; out of Cycle 1 scope. |
| `e2e/journey-real.spec.ts` | Dashboard heading not found after sign-in | Legacy sign-in flow and dashboard routing are not wired to the Foodcart admin app. | Logged; spec is gated by `REAL_API_URL` but still targets legacy flows. |

**Status:** Known non-regression — tracked for cleanup in a future cycle, not quarantined.

## Resolved Incidents

### 2026-06-24 — Backend lint and type-check failures blocking CI gate

- **Symptom**: `ruff check src tests` reported 20 errors (import order, unused imports, line length) and `mypy src` reported 18 errors (type mismatches in Foodcart routers/repositories).
- **Root cause**: Accumulated style debt from rapid Cycle 1 feature work; mypy strict mode flagged ORM ↔ domain entity conversions and generic `dict` annotations.
- **Mitigation**: Auto-fixed ruff violations, wrapped long lines, added `cast` / explicit schema conversions where ORM `.first()` can return `None`, and corrected `FoodcartBillingStatus` enum construction in repositories.
- **Status**: Resolved; `make ci` now passes.

### 2026-06-24 — Contract provider test SQLite database lock

- **Symptom**: `tests/contracts/test_foodcart_contract.py` intermittently failed with `sqlite3.OperationalError: database is locked`.
- **Root cause**: Provider verifier spawns a uvicorn worker that shared the same SQLite file as the test process.
- **Mitigation**: Switched the contract test run to a dedicated `test_contract.db` file with `check_same_thread=False` and isolated provider-state setup/teardown.
- **Status**: Resolved.

### 2026-06-24 — Backend SQLite transaction warnings during extended isolation tests

- **Symptom**: `test_tenant_isolation_extended.py` emitted `SAWarning` about unclosed SQLite connections.
- **Root cause**: Test fixtures create long-lived sessions while also using `TestClient` request sessions; SQLite file handles are closed by finalizers with a warning.
- **Mitigation**: Confirmed warnings are cosmetic and do not affect test outcomes or coverage. Connections are closed automatically on interpreter shutdown.
- **Status**: Accepted — no functional impact.

## Guidelines

1. When a test flakes, add an entry here before attempting a fix.
2. Include: test name, failure symptom, environment, frequency, root cause, mitigation.
3. Only quarantine after two failed stabilization attempts and with SDET + Tech Lead approval.
4. Re-evaluate this log weekly during squad sync.
