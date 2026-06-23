# Secret Management Checklist

Use this checklist when spinning up a new environment (local, CI, staging, or production). Never commit secrets to Git.

## Local development

- [ ] Copy `.env.example` to `.env` and fill in real values.
- [ ] Generate a strong `SECRET_KEY` (e.g., `openssl rand -base64 32`).
- [ ] Keep `ENV=development` so the dev-only auth endpoint is active.
- [ ] Use the Docker Compose PostgreSQL credentials or point `DATABASE_URL` to a local database.
- [ ] Do not use production OIDC credentials locally unless you are specifically testing Clerk/Auth0 integration.

## CI / GitHub Actions

- [ ] `CI_SECRET_KEY` — random 64+ character string used by backend tests and contract tests.
- [ ] `VERCEL_TOKEN` — personal/team token with deploy scope; rotate quarterly.
- [ ] `VERCEL_ORG_ID` — team/org ID for the Vercel account.
- [ ] `VERCEL_PROJECT_ID_BACKEND` / `VERCEL_PROJECT_ID_BACKEND_STAGING`
- [ ] `VERCEL_PROJECT_ID_FRONTEND` / `VERCEL_PROJECT_ID_FRONTEND_STAGING`
- [ ] `STAGING_DATABASE_URL` / `PRODUCTION_DATABASE_URL` — PostgreSQL connection strings.
- [ ] `CLERK_JWKS_URL`, `CLERK_AUDIENCE`, `CLERK_ISSUER` — only when using Clerk in production.
- [ ] `DORA_PUSHGATEWAY_USERNAME` / `DORA_PUSHGATEWAY_PASSWORD` — only if pushing DORA metrics to an authenticated Pushgateway.

## Staging environment

- [ ] `DATABASE_URL` set in Vercel backend project settings to the staging PostgreSQL host.
- [ ] `SECRET_KEY` unique from CI and production.
- [ ] `ENV=staging`.
- [ ] `ALLOWED_ORIGINS` includes the staging frontend domain.
- [ ] Optional: `UNLEASH_URL` + `UNLEASH_API_TOKEN` for managed feature flags.
- [ ] Optional: `OTEL_EXPORTER_OTLP_ENDPOINT` for staging telemetry.

## Production environment

- [ ] `DATABASE_URL` set in Vercel backend project settings to the production PostgreSQL host (Multi-AZ recommended).
- [ ] `SECRET_KEY` unique and strong; stored only in Vercel/GitHub Secrets.
- [ ] `ENV=production` so the dev-only auth endpoint is disabled.
- [ ] `ALLOWED_ORIGINS` includes only the production frontend domain(s).
- [ ] Clerk OIDC/OAuth2 credentials configured and the dev `/auth/token` endpoint disabled.
- [ ] Alertmanager/Slack webhook or PagerDuty integration key configured for incident response.
- [ ] DORA Pushgateway or Prometheus remote-write endpoint configured.

## Rotation & incident response

- Rotate `SECRET_KEY` and `VERCEL_TOKEN` immediately if there is any suspicion of exposure.
- Use `scripts/dora_pushgateway.py` and observability dashboards to verify service health after rotation.
- See `oncall.md` for the incident-response runbook.
