# Deployment Guide

## Overview

Foodcart SaaS is deployed as two Vercel projects (Next.js frontend + FastAPI
backend) backed by PostgreSQL and Redis. This guide covers environments,
secret requirements, the staging → production canary flow, ephemeral PR
environments, progressive delivery rings, and rollback.

Every merge to `main` that passes the `CI` and `Security` workflows is
considered releasable. The `deploy.yml` workflow then migrates data, deploys to
staging, runs smoke tests, deploys a backend canary to production, validates it
against SLOs, and finally promotes the canary to 100% traffic before tagging a
release candidate.

## Environments

| Environment | Purpose | Trigger |
|---|---|---|
| Local | Developer iteration | `docker compose up` |
| PR preview | Ephemeral Terraform workspace per PR | Infra changes on PRs |
| Staging | Integration / pre-prod validation | Every green `main` build |
| Production | Live tenant traffic | Manual or automated promotion after canary |

### Local environment

```bash
cp .env.example .env
# Edit .env with local secrets, then:
docker compose up -d db redis backend frontend
```

The backend runs on `http://localhost:8000` and the frontend on
`http://localhost:3000`.

### PR preview environment

- Workflow: `.github/workflows/pr-environment.yml`
- Triggered by changes to `infra/**` or the workflow itself.
- Creates an isolated Terraform workspace named `pr-<number>`.
- Resources are destroyed automatically when the PR is closed.
- Requires `vars.AWS_ROLE_ARN` and `secrets.TERRAFORM_BACKEND_CONFIG`.

### Staging environment

- Vercel project: `foodcart-frontend-staging`, `foodcart-backend-staging`
- Database: staging PostgreSQL instance
- Migrations run automatically before the backend deploys
- Smoke tests run after both services are deployed

### Production environment

- Vercel project: `foodcart-frontend`, `foodcart-backend`
- Database: production PostgreSQL instance
- Backend is released through a 5% canary before full promotion
- Frontend deploys to production after staging smoke tests pass
- A deployment candidate tag (`release-<short-sha>-<run_number>`) is created
  after production smoke tests and the final SLO check pass

## Progressive Delivery Rings

Releases move through the rings below. In the automated pipeline the canary
percentage is shifted by `scripts/set_canary.py`; rings with longer soak
periods are executed outside of CI via the same script or feature flags.

| Ring | Audience | Canary % | Soak / Gate |
|---|---|---|---|
| Ring 0 | Internal team (employees, internal tenants) | 0% → 5% | 24–48 hours; synthetic smoke tests pass |
| Ring 1 | 1–5% of live tenants | 5% | Error rate < 0.1% and p95 latency < 300ms for 5 minutes |
| Ring 2 | 10–25% of live tenants | 25% | No SLO breaches for 15–30 minutes |
| Ring 3 | General availability | 100% | Final production smoke tests and SLO check pass |

The CI/CD pipeline implements Ring 1 automatically. Promotion to Rings 2 and 3
can be triggered manually or by automated ring-expansion jobs that call
`scripts/set_canary.py` and `scripts/slo_check.py` after the soak window.

## Required Secrets & Variables

All values below are placeholders. Configure them in GitHub Environment
secrets (`staging`, `production`) and repository variables.

### Repository secrets

| Secret | Used by | Description |
|---|---|---|
| `CI_SECRET_KEY` | CI tests | Random key for backend test sessions |
| `VERCEL_TOKEN` | Deploy | Vercel API token |
| `VERCEL_ORG_ID` | Deploy | Vercel team / org ID |

### Staging environment secrets

| Secret | Description |
|---|---|
| `STAGING_DATABASE_URL` | PostgreSQL connection string for migrations |
| `VERCEL_PROJECT_ID_FRONTEND_STAGING` | Vercel project ID for frontend staging |
| `VERCEL_PROJECT_ID_BACKEND_STAGING` | Vercel project ID for backend staging |

### Production environment secrets

| Secret | Description |
|---|---|
| `PRODUCTION_DATABASE_URL` | PostgreSQL connection string for migrations |
| `VERCEL_PROJECT_ID_FRONTEND` | Vercel project ID for frontend production |
| `VERCEL_PROJECT_ID_BACKEND` | Vercel project ID for backend production |
| `VERCEL_PROJECT_ID_BACKEND_CANARY` | Vercel project ID for canary backend |
| `VERCEL_EDGE_CONFIG_ID` | Edge Config used to shift traffic between backend versions |

### Repository variables

| Variable | Description |
|---|---|
| `AWS_ROLE_ARN` | OIDC role for AWS access (optional) |
| `AWS_REGION` | AWS region, e.g. `us-east-1` |
| `STAGING_API_URL` | Public staging backend URL |
| `PRODUCTION_API_URL` | Public production backend URL |
| `PRODUCTION_BACKEND_URL` | Production backend base URL for smoke tests |
| `PRODUCTION_FRONTEND_URL` | Production frontend base URL for smoke tests |
| `PROMETHEUS_URL` | Prometheus URL for SLO checks (optional) |

### AI assistant secrets

| Secret | Description |
|---|---|
| `GEMINI_API_KEY` | Google Gemini API key for the AI Website Assistant (required in production) |

### Repository variables (continued)

| Variable | Description |
|---|---|
| `GEMINI_MODEL` | Gemini model name, e.g. `gemini-2.0-flash` (defaults to `gemini-2.0-flash`) |

## Release Checklist

Before approving or triggering a production release, confirm:

- [ ] The commit on `main` has green `CI` and `Security` workflow runs.
- [ ] The deploy gate job in `deploy.yml` reports `proceed=true`.
- [ ] Staging migrations ran successfully and staging smoke tests pass.
- [ ] A production database backup was taken (or automated backups are current).
- [ ] Feature flags for the release are configured and default to off.
- [ ] The on-call rotation is aware a release is in progress.
- [ ] Grafana / Vercel Analytics dashboards are open for monitoring.
- [ ] Product Owner has drafted release notes / stakeholder communication.

## Deployment Flow

The `deploy.yml` workflow implements the following flow:

1. **Gate** — only proceed if both `CI` and `Security` workflows succeeded for
   the commit on `main`.
2. **Migrate staging** — run Alembic migrations against the staging database.
3. **Deploy backend to staging** — Vercel deployment of the FastAPI backend.
4. **Deploy frontend to staging** — Vercel deployment of the Next.js frontend.
5. **Smoke test staging** — verify `/health` and the frontend landing page.
6. **Migrate production** — run Alembic migrations against the production
   database.
7. **Deploy backend canary** — deploy to the canary project.
8. **Enable canary routing (Ring 1)** — route 5% of traffic to the canary
   backend via Vercel Edge Config and run an immediate health probe with
   `scripts/set_canary.py --require-healthy`.
9. **Deploy frontend production** — deploy the Next.js frontend to production.
10. **Canary analysis** — `scripts/canary_analysis.py` compares error rate and
    latency between baseline and canary and emits a `PROMOTE`/`ROLLBACK`
    recommendation.
11. **SLO check (canary window)** — `scripts/slo_check.py` evaluates Prometheus
    metrics for availability, error rate, latency, and saturation against the
    thresholds in `docs/SLOs.md`.
12. **Promote canary** — deploy the backend to the production project and
    disable canary routing with `scripts/set_canary.py --percentage 0`.
13. **Smoke test production** — verify production health.
14. **SLO check (production)** — final SLO validation after 100% traffic shift.
15. **Tag release** — create a `release-<short-sha>-<run_number>` deployment
    candidate tag.
16. **Rollback on failure** — if canary analysis, SLO checks, or production
    smoke tests fail, disable canary and roll back to the previous production
    deployment.


## Rollback Procedure

If an incident is detected, prefer rollback over forward fixes.

### Automated rollback

`deploy.yml` includes a `rollback-on-failure` job that runs when canary
analysis, SLO checks, or production smoke tests fail. It:

1. Disables canary routing to 0% with `scripts/set_canary.py`.
2. Finds the previous ready production deployment for both backend and
   frontend.
3. Runs `vercel rollback <url>` for each service.
4. Re-runs health checks.

### Manual rollback

```bash
# 1. Identify the bad release
gh run list --workflow=deploy.yml

# 2. Disable canary routing immediately
python scripts/set_canary.py \
  --edge-config-id "$VERCEL_EDGE_CONFIG_ID" \
  --vercel-token "$VERCEL_TOKEN" \
  --team-id "$VERCEL_ORG_ID" \
  --percentage 0

# 3. Verify the current SLO state
python scripts/slo_check.py \
  --prometheus-url "$PROMETHEUS_URL" \
  --window 5m \
  --availability-threshold 0.999 \
  --error-rate-threshold 0.001 \
  --latency-p95-threshold 0.3 \
  --recommend

# 4. Roll back backend
vercel rollback https://<previous-backend-url> --token "$VERCEL_TOKEN" --yes

# 5. Roll back frontend
vercel rollback https://<previous-frontend-url> --token "$VERCEL_TOKEN" --yes

# 6. Verify health
curl -fsS https://<production-backend>/health
curl -fsS https://<production-frontend>

# 7. Communicate in #incidents
```

### Database rollback

- Migrations are forward-only in normal operation.
- If a migration caused data corruption, restore from the most recent backup
  before running `alembic downgrade`.
- Document any data fixes in the incident post-mortem.

## Feature Flags

Use Unleash for gradual rollouts and kill switches. In an emergency, disable
the flag before rolling back code.

### Flag cleanup policy

- Remove flags within 30 days of full rollout.
- Maintain fewer than 20–30 active flags per service.
- Review active flags in the weekly release sync.

## Observability

- Metrics: Prometheus + Grafana (`/observability`)
- Traces: OpenTelemetry → Tempo
- Logs: Loki
- Real user monitoring: Vercel Analytics + web-vitals

See `docs/SLOs.md` for alert thresholds and error budgets.
