# Elite Vercel Setup Checklist

This checklist captures everything needed to make the Vercel-only deploy pipeline production-grade. The Vercel projects have already been created; the remaining items require database URLs and GitHub repository configuration.

## Already configured

| Project | GitHub secret | Vercel project ID | Root directory | Framework |
|---|---|---|---|---|
| `elite-backend` | `VERCEL_PROJECT_ID_BACKEND` | `prj_D0CpuAXOsGlS7YFaBcxLxPeVxFa6` | `src/backend` | Other |
| `elite-backend-staging` | `VERCEL_PROJECT_ID_BACKEND_STAGING` | `prj_UT1dKRlmpylItx7fgdmEeoqCgTde` | `src/backend` | Other |
| `elite-frontend` | `VERCEL_PROJECT_ID_FRONTEND` | `prj_Q3zctiDsLvpDrIV6OUfV1cQlX9jb` | `src/frontend` | Next.js |
| `elite-frontend-staging` | `VERCEL_PROJECT_ID_FRONTEND_STAGING` | `prj_PHwrzmWbf2qaLkEi6OotpJerAsCF` | `src/frontend` | Next.js |

The local directories are linked to the production projects via `.vercel/project.json` so you can deploy with your logged-in CLI:

```bash
make deploy-local-backend      # preview deploy
make deploy-local-backend-prod # production deploy
make deploy-local-frontend     # preview deploy
make deploy-local-frontend-prod# production deploy
```

## 1. GitHub repository secrets

Add these in **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `VERCEL_TOKEN` | *your Vercel token* |
| `VERCEL_ORG_ID` | `team_5NBoD8CCbWekEbrdn1Ixq8cR` |
| `VERCEL_PROJECT_ID_BACKEND` | `prj_D0CpuAXOsGlS7YFaBcxLxPeVxFa6` |
| `VERCEL_PROJECT_ID_BACKEND_STAGING` | `prj_UT1dKRlmpylItx7fgdmEeoqCgTde` |
| `VERCEL_PROJECT_ID_FRONTEND` | `prj_Q3zctiDsLvpDrIV6OUfV1cQlX9jb` |
| `VERCEL_PROJECT_ID_FRONTEND_STAGING` | `prj_PHwrzmWbf2qaLkEi6OotpJerAsCF` |
| `STAGING_DATABASE_URL` | *your staging PostgreSQL URL* |
| `PRODUCTION_DATABASE_URL` | *your production PostgreSQL URL* |

Or run the helper script (token is read from `VERCEL_TOKEN` env or prompt):

```bash
cd example_project
VERCEL_TOKEN=<your-token> ./scripts/set-vercel-github-secrets.sh
```

## 2. GitHub repository variables

Add these in **Settings → Secrets and variables → Actions → Variables**:

| Variable | Suggested value |
|---|---|
| `STAGING_API_URL` | `https://elite-backend-staging.vercel.app` |
| `STAGING_BACKEND_URL` | `https://elite-backend-staging.vercel.app` |
| `STAGING_FRONTEND_URL` | `https://elite-frontend-staging.vercel.app` |
| `PRODUCTION_API_URL` | `https://elite-backend.vercel.app` |
| `PRODUCTION_BACKEND_URL` | `https://elite-backend.vercel.app` |
| `PRODUCTION_FRONTEND_URL` | `https://elite-frontend.vercel.app` |
| `LOAD_TEST_BASE_URL` | staging or production backend URL |

## 3. Vercel project environment variables

For **each** backend project, set in the Vercel dashboard:

- `DATABASE_URL` — pooled PostgreSQL connection string.
- `SECRET_KEY` — 64+ character random string (different per environment).
- `ENV` — `staging` or `production`.
- `ALLOWED_ORIGINS` — exact frontend URL(s) for that environment.
- `CLERK_JWKS_URL`, `CLERK_ISSUER`, `CLERK_AUDIENCE` — when Clerk is enabled.
- `OTEL_EXPORTER_OTLP_ENDPOINT` — optional, for managed traces/metrics/logs.
- `METRICS_ENABLED` — set to `false` on Vercel to disable Prometheus.

For **each** frontend project, set in the Vercel dashboard:

- `NEXT_PUBLIC_API_URL` — the matching backend URL + `/api/v1`.
- `NEXT_PUBLIC_ENABLED_FEATURES` — comma-separated feature flags.
- Clerk frontend keys when Clerk integration is enabled.

## 4. GitHub environments & protection rules

Create two environments in **Settings → Environments**:

- `staging`
- `production`

For `production`, enable:

- [ ] Required reviewers (at least 1).
- [ ] Wait timer (optional, e.g. 5 minutes).
- [ ] Deployment branches: restrict to `main`.

## 5. Database setup

- [ ] Staging PostgreSQL provisioned and reachable from Vercel.
- [ ] Production PostgreSQL provisioned and reachable from Vercel.
- [ ] Connection strings use a pooled URL (e.g. Neon pooled URL or PgBouncer).
- [ ] Run initial migration via `migrate.yml` workflow for each environment.

## 6. End-to-end verification

- [ ] Push to `main` triggers `CI` and `Security` workflows.
- [ ] Both succeed and trigger `deploy.yml`.
- [ ] Staging migrations, backend deploy, frontend build/deploy, and smoke tests pass.
- [ ] Production deploy waits for the `production` environment approval.
- [ ] Canary and production smoke tests pass.

## 7. Elite hardening extras (optional)

- [ ] Enable **Vercel Deployment Protection** on production projects.
- [ ] Enable **OIDC / SAML** for Vercel team access.
- [ ] Configure custom domains with TLS for staging and production.
- [ ] Enable **Vercel Analytics** and **Speed Insights** for the frontend.
- [ ] Add **Vercel Log Drains** to ship logs to your observability backend.
- [ ] Configure **Budgets** and **Alerts** in Vercel for traffic/cost spikes.
