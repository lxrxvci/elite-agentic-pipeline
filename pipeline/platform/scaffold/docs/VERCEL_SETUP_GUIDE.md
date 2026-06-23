# Step-by-Step Vercel Production Setup Guide

This guide walks through everything still needed after the Vercel projects were created and the workflows were configured.

Estimated time: 30–60 minutes if you already have a PostgreSQL provider. Longer if you also need to provision databases.

---

## 1. Choose a PostgreSQL provider

Because the backend is serverless on Vercel, use a **pooled** PostgreSQL connection string. Recommended providers:

- **Neon** (serverless, scales to zero, built-in pooled URLs) — fastest for this stack.
- **Supabase** (managed Postgres + pooled connection string).
- **AWS RDS + PgBouncer** if you want full control.

The rest of this guide uses Neon as the example, but the concepts are the same for any provider.

### Example: Neon setup

1. Go to <https://neon.tech> and sign up/log in.
2. Create two projects:
   - `elite-staging`
   - `elite-production`
3. In each project, go to **Connection Details**.
4. Select **Pooled connection** and copy the URL.
5. The URL looks like:
   ```text
   postgresql+psycopg://user:password@host-pooler.region.aws.neon.tech/elite_db?sslmode=require
   ```

> Keep both URLs handy — you will paste them into GitHub secrets and Vercel project settings.

---

## 2. Set GitHub repository secrets

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**.

Add these secrets exactly:

| Secret | Value |
|---|---|
| `VERCEL_TOKEN` | Your Vercel token (used to create the projects) |
| `VERCEL_ORG_ID` | `team_5NBoD8CCbWekEbrdn1Ixq8cR` |
| `VERCEL_PROJECT_ID_BACKEND` | `prj_D0CpuAXOsGlS7YFaBcxLxPeVxFa6` |
| `VERCEL_PROJECT_ID_BACKEND_STAGING` | `prj_UT1dKRlmpylItx7fgdmEeoqCgTde` |
| `VERCEL_PROJECT_ID_FRONTEND` | `prj_Q3zctiDsLvpDrIV6OUfV1cQlX9jb` |
| `VERCEL_PROJECT_ID_FRONTEND_STAGING` | `prj_PHwrzmWbf2qaLkEi6OotpJerAsCF` |
| `STAGING_DATABASE_URL` | Staging pooled PostgreSQL URL |
| `PRODUCTION_DATABASE_URL` | Production pooled PostgreSQL URL |

### Quick way: use the helper script

From the repo root:

```bash
cd example_project
VERCEL_TOKEN=<paste-your-token> ./scripts/set-vercel-github-secrets.sh
```

Then add the two database secrets manually:

```bash
gh secret set STAGING_DATABASE_URL --body "<staging-pooled-url>"
gh secret set PRODUCTION_DATABASE_URL --body "<production-pooled-url>"
```

---

## 3. Set GitHub repository variables

Go to **Settings → Secrets and variables → Actions → Variables tab → New repository variable**.

| Variable | Value |
|---|---|
| `STAGING_API_URL` | `https://elite-backend-staging.vercel.app` |
| `STAGING_BACKEND_URL` | `https://elite-backend-staging.vercel.app` |
| `STAGING_FRONTEND_URL` | `https://elite-frontend-staging.vercel.app` |
| `PRODUCTION_API_URL` | `https://elite-backend.vercel.app` |
| `PRODUCTION_BACKEND_URL` | `https://elite-backend.vercel.app` |
| `PRODUCTION_FRONTEND_URL` | `https://elite-frontend.vercel.app` |
| `LOAD_TEST_BASE_URL` | `https://elite-backend-staging.vercel.app` |

### Quick way: use `gh`

```bash
gh variable set STAGING_API_URL --body "https://elite-backend-staging.vercel.app"
gh variable set STAGING_BACKEND_URL --body "https://elite-backend-staging.vercel.app"
gh variable set STAGING_FRONTEND_URL --body "https://elite-frontend-staging.vercel.app"
gh variable set PRODUCTION_API_URL --body "https://elite-backend.vercel.app"
gh variable set PRODUCTION_BACKEND_URL --body "https://elite-backend.vercel.app"
gh variable set PRODUCTION_FRONTEND_URL --body "https://elite-frontend.vercel.app"
gh variable set LOAD_TEST_BASE_URL --body "https://elite-backend-staging.vercel.app"
```

---

## 4. Set Vercel project environment variables

For each of the four projects, open the Vercel dashboard, go to **Settings → Environment Variables**, and add the variables below.

### Generate secrets locally

Run these once to create strong random values:

```bash
# Backend SECRET_KEY (64 bytes, URL-safe)
python3 -c "import secrets; print(secrets.token_urlsafe(64))"

# Repeat for production so it is different from staging
python3 -c "import secrets; print(secrets.token_urlsafe(64))"
```

### 4a. `elite-backend-staging`

| Key | Value | Environment |
|---|---|---|
| `DATABASE_URL` | staging pooled PostgreSQL URL | Production, Preview, Development |
| `SECRET_KEY` | random 64-char string | Production, Preview, Development |
| `ENV` | `staging` | Production, Preview, Development |
| `ALLOWED_ORIGINS` | `https://elite-frontend-staging.vercel.app` | Production, Preview, Development |
| `METRICS_ENABLED` | `false` | Production, Preview, Development |

### 4b. `elite-backend` (production)

| Key | Value | Environment |
|---|---|---|
| `DATABASE_URL` | production pooled PostgreSQL URL | Production, Preview, Development |
| `SECRET_KEY` | a different random 64-char string | Production, Preview, Development |
| `ENV` | `production` | Production, Preview, Development |
| `ALLOWED_ORIGINS` | `https://elite-frontend.vercel.app` | Production, Preview, Development |
| `METRICS_ENABLED` | `false` | Production, Preview, Development |

### 4c. `elite-frontend-staging`

| Key | Value | Environment |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://elite-backend-staging.vercel.app/api/v1` | Production, Preview, Development |
| `NEXT_PUBLIC_ENABLED_FEATURES` | *(comma-separated flags, or leave empty)* | Production, Preview, Development |

### 4d. `elite-frontend` (production)

| Key | Value | Environment |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://elite-backend.vercel.app/api/v1` | Production, Preview, Development |
| `NEXT_PUBLIC_ENABLED_FEATURES` | *(comma-separated flags, or leave empty)* | Production, Preview, Development |

> Apply the environment variables and redeploy any existing deployments if Vercel prompts you to.

---

## 5. Configure GitHub environments

Go to **Settings → Environments**.

### Create `staging`

1. Click **New environment**.
2. Name it `staging`.
3. No protection rules are required, but you can add a wait timer if you want.

### Create `production`

1. Click **New environment**.
2. Name it `production`.
3. Enable **Required reviewers** and add yourself (or your team).
4. Optional: enable a **Wait timer** (e.g. 5 minutes) for a built-in pause before production deploys.
5. Under **Deployment branches**, select **Restricted** and allow only `main`.

---

## 6. Run database migrations

### 6a. Staging

Go to **Actions → Database Migration → Run workflow**:

- `environment`: `staging`
- `command`: `upgrade`
- `revision`: leave empty

Click **Run workflow**.

### 6b. Production

Repeat for `production`.

> The workflow has a backup reminder step. Make sure your production database has backups enabled before running production migrations.

---

## 7. Verify the full pipeline

1. Push any small change to `main` (or merge a PR).
2. Watch the **CI** and **Security** workflows run.
3. Once both succeed, the **Deploy** workflow should start automatically.
4. The deploy workflow will:
   - Migrate and deploy backend + frontend to **staging**.
   - Run smoke tests against staging.
   - Wait for the `production` environment approval.
   - After approval, migrate and deploy backend + frontend to **production**.
   - Run synthetic canary and production smoke tests.
5. If the canary or smoke tests fail, the workflow automatically rolls back both production Vercel projects.

### Manual approval

When the deploy reaches the production environment, GitHub will send you a notification/email. Approve it in the Actions UI to continue.

---

## 8. Optional: test a local deploy

Because `.vercel/project.json` is already linked to the production projects, you can deploy locally using your logged-in CLI:

```bash
cd example_project

# Backend preview deploy
make deploy-local-backend

# Frontend preview deploy (uses staging backend by default)
make deploy-local-frontend

# Production deploys
make deploy-local-backend-prod
make deploy-local-frontend-prod
```

> Preview deploys create unique URLs and do not affect production traffic.

---

## 9. Optional elite hardening

After the first successful deploy, consider:

- [ ] Enable **Vercel Deployment Protection** on production projects.
- [ ] Add custom domains with automatic TLS for staging and production.
- [ ] Enable **Vercel Analytics** and **Speed Insights** for the frontend.
- [ ] Add **Vercel Log Drains** to ship logs to Grafana/Loki.
- [ ] Configure **Budgets** and **Alerts** in Vercel.
- [ ] Rotate the `VERCEL_TOKEN` to a project-scoped token once Vercel supports it for your team.

---

## Troubleshooting

### Deploy workflow never starts

The deploy workflow triggers on successful completion of **CI** and **Security**. Make sure both are listed in the **Actions** tab and completed successfully.

### Backend deploy fails with Python import errors

Make sure `src/backend/requirements.txt` exists and contains all dependencies. The deploy uses `src/backend/vercel.json` with framework preset `Other`.

### Frontend calls the wrong backend

Frontend builds happen in CI with `NEXT_PUBLIC_API_URL` set from GitHub variables. Verify the variables in **Settings → Secrets and variables → Actions → Variables**.

### Database connection errors

Use a **pooled** connection string. Vercel serverless functions open many short-lived connections; a pooled URL prevents exhausting the database.

### Migrations fail

Make sure `STAGING_DATABASE_URL` / `PRODUCTION_DATABASE_URL` use `postgresql+psycopg://` and that the user has CREATE/ALTER permissions.
