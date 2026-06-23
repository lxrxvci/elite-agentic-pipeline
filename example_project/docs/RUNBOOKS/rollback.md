# Runbook: Rollback

## When to Rollback

- Recent deploy caused increased errors or latency.
- Feature flag flip caused unexpected behavior.
- Data corruption or security issue introduced.
- Synthetic canary or smoke tests fail after a production deploy.

## Automatic Rollback

The `deploy.yml` workflow runs an automatic rollback job (`rollback-on-failure`) if the production canary or smoke tests fail. It rolls back both the backend and frontend Vercel production projects and re-checks health.

If automatic rollback succeeds, treat it as a mitigated incident and follow the verification and communication steps below.

## Manual Steps

### 1. Identify the bad release

```bash
gh run list --workflow=deploy.yml
# or inspect Vercel deployments in the dashboard
```

### 2. Stop traffic (if needed)

- Flip feature flag to off.
- Enable a maintenance page if required.
- For Vercel, you can temporarily assign the previous production deployment as active.

### 3. Roll back via GitHub Actions

Run the `rollback.yml` workflow:

```bash
gh workflow run rollback.yml -f target=backend -f environment=production
gh workflow run rollback.yml -f target=frontend -f environment=production
```

Or use the Vercel CLI directly:

```bash
vercel rollback <project-id> --token $VERCEL_TOKEN --yes
```

### 4. Roll back database (if safe)

- Run downgrades only after backups.
- Document any data fixes needed.

### 5. Verify

- Check `/api/v1/health` on the backend.
- Confirm the frontend loads and key user journeys work.
- Review error rate and latency dashboards.

### 6. Communicate

Update the incident channel with rollback status and next steps.

## Required Secrets / Variables

Ensure these are set in GitHub before any deploy or rollback:

| Secret / Variable | Purpose |
|---|---|
| `VERCEL_TOKEN` | Vercel CLI authentication |
| `VERCEL_ORG_ID` | Vercel team/org |
| `VERCEL_PROJECT_ID_BACKEND` | Production backend Vercel project |
| `VERCEL_PROJECT_ID_BACKEND_STAGING` | Staging backend Vercel project |
| `VERCEL_PROJECT_ID_FRONTEND` | Production frontend Vercel project |
| `VERCEL_PROJECT_ID_FRONTEND_STAGING` | Staging frontend Vercel project |
| `PRODUCTION_BACKEND_URL` / `PRODUCTION_FRONTEND_URL` | Health-check URLs |
| `STAGING_BACKEND_URL` / `STAGING_FRONTEND_URL` | Staging health-check URLs |
