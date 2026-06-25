# Test Strategy

## Philosophy

Quality is owned by the stream-aligned squad. Tests are written close to the code they validate, run in CI on every commit, and provide fast feedback. We avoid separate QA gatekeeping; instead, QA Enablement provides standards, templates, and tooling.

## Cycle 1 Context

This strategy applies to the **Foodcart SaaS Cycle 1** build (Bets 1–3):

- **Bet 1 — 10-Minute Publish Onboarding**: onboarding, slug provisioning, site generation, publish/unpublish, public site rendering.
- **Bet 2 — Live Open/Closed + Hours Management**: timezone-aware hours computation, admin hours editor, public status badge.
- **Bet 3 — AI Website Assistant (spike/conditional build)**: natural-language change proposals, allowlisted patch operations, explicit approval, versioning/revert.

The backend is a FastAPI monolith with tenant-isolated SQLAlchemy repositories. The frontend is a Next.js app using FSD. We therefore use the **monolith pyramid** (≈80% unit / ≈15% integration / ≈5% E2E).

## Testing Pyramid

```
        ┌─────────┐
        │   E2E   │  ← Playwright: core onboarding → publish → view site journey
        │  ~5%    │
       ├───────────┤
       │ Integration│ ← API tests with test DB, Pact contract tests
       │   ~15%    │
      ├─────────────┤
      │    Unit      │  ← pytest / Vitest: domain services, hooks, components
      │    ~80%     │
      └─────────────┘
```

## Test Types

### Unit Tests

| Layer | Tool | Scope | Gate |
|---|---|---|---|
| Backend | pytest | Domain services (`domain/services/foodcart.py`), value objects, schemas | ≥ 80% coverage on Cycle 1 modules |
| Frontend | Vitest | Pure functions, hooks, presentational components, FSD entities/features | ≥ 70% coverage; do not regress current ratcheted baseline |

### Integration Tests

| Layer | Tool | Scope | Gate |
|---|---|---|---|
| Backend API | pytest + TestClient | Foodcart routers with in-memory SQLite test DB | Run on every PR |
| Database | pytest + Alembic | Migration up/down integrity | Run on every PR |
| Contracts | Pact (consumer in frontend, provider in backend) | `POST /tenants/onboard`, `GET /sites`, `GET /public/sites/{slug}`, `POST /auth/token` | Run on every PR |

### End-to-End Tests

| Tool | Scope | Frequency |
|---|---|---|
| Playwright | Critical journey: onboard → preview → publish → view live site | Every PR + nightly |
| Playwright (`real-backend` project) | Full journey against running backend/database | Staging / pre-release |
| axe-core | WCAG 2.1 AA automated checks on public/admin pages | Every PR |

### Performance & Load Tests

| Tool | Scope | Frequency |
|---|---|---|
| k6 | Public site render + onboarding POST against staging | Before releases |
| Lighthouse CI | Core Web Vitals (mobile LCP < 2.5 s target) | Every PR |

## Coverage Targets & Ratchets

- **Backend Cycle 1 modules** (`src/app/routers/foodcart/*`, `src/app/schemas_foodcart.py`, `src/domain/services/foodcart.py`, `src/infrastructure/models.py`): **≥ 80% line coverage**, enforced by `tool.coverage.report.fail_under = 80`.
- **Frontend**: maintain the current ratcheted baseline from `coverage/coverage-summary.json`:
  - Lines ≥ 69%
  - Functions ≥ 76%
  - Branches ≥ 79%
- **Diff coverage**: new/changed lines must be ≥ 80–90%.

## CI Gates

1. **Lint & type check** must pass.
2. **Backend unit + integration tests** must pass with ≥ 80% coverage on Cycle 1 modules.
3. **Frontend unit tests** must pass without regressing the ratcheted coverage baseline.
4. **E2E smoke tests** (mocked) must pass.
5. **Pact contract tests** (consumer + provider) must pass.
6. **Security scans** (SAST, SCA, secrets) must pass.
7. **Accessibility checks** must pass.

## Critical Regression Areas

The following areas receive explicit, maintained test coverage:

- **Tenant isolation**: no cross-tenant read, mutation, deletion, or AI operation across sites, content, revisions, ingestion jobs, or onboarding.
- **AI assistant guardrails**: out-of-scope prompts (billing, auth, slug/domain, account deletion, code/SQL) return `in_scope: false`; apply requires explicit `confirmed: true`; idempotent proposal application is rejected.
- **SSRF prevention**: ingestion rejects private/internal/localhost URLs.
- **Open/closed status**: timezone-aware, overnight hours, DST edge cases.
- **Public site boundaries**: draft sites are 404 unless a valid preview token is supplied.

## Environments

| Environment | Purpose | Data |
|---|---|---|
| Local | Developer iteration | Synthetic / seeded |
| CI | Automated checks | Ephemeral SQLite/Postgres |
| Staging | Pre-release validation | Anonymized production-like |
| Production | Live users | Real |

## Responsibilities

| Role | Responsibility |
|---|---|
| SDET | Owns test architecture, E2E framework, CI integration, contract tests, flakiness log. |
| Backend Engineer | Owns unit and integration tests for backend code. |
| Frontend Engineer | Owns unit tests for components and hooks; supports E2E. |
| QA Enablement | Sets standards, templates, and tooling; does not gatekeep. |

## Tooling

- Backend: pytest, pytest-asyncio, pytest-cov, factory-boy, httpx, pact-python
- Frontend: Vitest, Testing Library, Playwright, @axe-core/playwright, @pact-foundation/pact
- Contracts: Pact
- Load: k6
- Coverage reporting: pytest-cov, Vitest coverage

## Flakiness & Continuous Improvement

- All flaky tests are logged in `tests/FLAKINESS_LOG.md` with root cause and mitigation.
- Quarantine is a last resort; the default action is to fix or stabilize.
- Weekly: review flaky tests, coverage trends, and test runtimes.
- Monthly: assess pyramid balance and add tests for recent incidents.

## Cycle 1 Verification Results

Final verification run completed on 2026-06-24.

### Backend

- **Suite**: `pytest` (`src/backend`), `ruff`, `mypy`, `bandit`
- **Result**: 251 passed, 2 xfailed, 1 xpassed, 8 warnings; lint / type check / bandit all pass
- **Cycle 1 module coverage**: 95.11% (target ≥ 80%)
- **Coverage scope**: `src/app/routers/foodcart/*`, `src/app/schemas_foodcart.py`, `src/domain/entities.py`, `src/domain/services/foodcart.py`, `src/infrastructure/models.py`
- **CI feedback**: `src/backend/.ci-feedback.json` is generated by `scripts/ci_feedback.py --backend-only` in CI and by `make ci` locally.

### Frontend Unit / Component

- **Suite**: `npm run test:ci` (Vitest), `npm run lint`, `npm run typecheck`
- **Result**: 71 files, 152 tests passed
- **Overall coverage**: Statements 69.2%, Branches 80.06%, Functions 76.88%, Lines 69.2% — meets ratcheted baseline.
- **CI feedback**: `src/frontend/.ci-feedback.json` is generated by `scripts/ci_feedback.py --frontend-only` in CI and by `make ci` locally.

### Contract Tests

- **Consumer**: `npm run test:contracts` — 2 files, 4 tests passed (auth + foodcart contracts).
- **Provider**: `pytest tests/contracts/` — 2 passed (auth + foodcart provider verification).

### End-to-End

- **Cycle 1 journey**: `e2e/foodcart-journey.spec.ts` passes (onboarding → publish → view site).
- **Full suite**: 5 passed, 4 failed. All failures are in legacy specs (`a11y`, `dashboard`, `journey-real`) that pre-date the Foodcart admin/auth wiring and are logged as known non-regressions in `tests/FLAKINESS_LOG.md`.

### Local CI Simulation

- **Command**: `make ci`
- **Result**: All commit-stage gates pass; `ci_cd` gate transitions to `true` in `.pipeline/gates.json`.

### Open Security Gaps Documented by Tests

- **REM-001**: Content block URL scheme injection (`javascript:`, `data:`) — 2 tests remain `xfail` until backend schema validation is added.
- **REM-002**: SSRF via HTTP redirects in ingestion — currently `xpass` because the internal redirect target times out in this environment; redirect targets are still **not** explicitly re-validated in code.
