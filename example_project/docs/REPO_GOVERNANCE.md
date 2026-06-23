# Repository Governance

## Branch Protection (main)

Configure these rules in GitHub repository settings:

- **Require a pull request before merging**
  - Require approvals: 1
  - Dismiss stale PR approvals when new commits are pushed
  - Require review from CODEOWNERS
- **Require status checks to pass before merging**
  - `CI required checks`
  - `Contract tests required`
  - `scan` (from security.yml)
  - `secrets` (from dependency-review.yml / TruffleHog)
  - `Platform Workflow Drift Check`
- **Require conversation resolution before merging**
- **Require signed commits** (recommended)
- **Require linear history** (enforce squash merge)
- **Allow force pushes:** No
- **Allow deletions:** No

## Merge Strategy

- Use **squash merge** only.
- Commit message should follow conventional commits (e.g., `feat:`, `fix:`, `chore:`).

## Required GitHub Secrets

| Secret | Used In |
|---|---|
| `VERCEL_TOKEN` | deploy.yml |
| `VERCEL_ORG_ID` | deploy.yml |
| `VERCEL_PROJECT_ID_BACKEND` | deploy.yml |
| `VERCEL_PROJECT_ID_FRONTEND` | deploy.yml |
| `VERCEL_PROJECT_ID_BACKEND_STAGING` | deploy.yml |
| `VERCEL_PROJECT_ID_FRONTEND_STAGING` | deploy.yml |
| `STAGING_DATABASE_URL` | deploy.yml, migrate.yml |
| `PRODUCTION_DATABASE_URL` | deploy.yml, migrate.yml |
| `CI_SECRET_KEY` | ci.yml, contract-tests.yml |
| `CLERK_JWKS_URL` | backend runtime |
| `CLERK_AUDIENCE` | backend runtime |

## Required GitHub Variables

| Variable | Purpose |
|---|---|
| `STAGING_API_URL` | Frontend build-time API URL |
| `PRODUCTION_BACKEND_URL` | Smoke tests / rollback health checks |
| `PRODUCTION_FRONTEND_URL` | Smoke tests / rollback health checks |

## Teams

Replace placeholder CODEOWNERS teams with real GitHub teams:

- `@elite-squad/backend`
- `@elite-squad/frontend`
- `@elite-squad/platform`

## Dependency Graph

Enable **Dependency graph** and **Dependabot alerts** in repository settings so `dependency-review-action` can run.
