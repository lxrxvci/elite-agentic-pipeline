# Secrets Management — Foodcart SaaS

| Attribute | Value |
|---|---|
| Product | Foodcart SaaS |
| Author | AppSec Engineering |
| Date | 2026-06-24 |
| Status | Active |
| Classification | Internal |

## Purpose

This document inventories the secrets used by Foodcart SaaS, how they are stored, how they are injected in CI/CD, and the rotation policy. It supports the controls in `docs/THREAT_MODEL.md` (T011 secrets leakage, T002 authentication bypass) and `docs/SECURE_CODING_GUIDE.md`.

## Secret inventory

| Secret | Environment variable | Used by | Storage | Rotation |
|---|---|---|---|---|
| Application signing key | `SECRET_KEY` | Backend JWT / preview token HMAC | GitHub secret + AWS Secrets Manager | 90 days or on compromise |
| Database connection string | `DATABASE_URL` | Backend, migrations, Alembic | GitHub environment secret + AWS Secrets Manager | 90 days or on compromise |
| Clerk JWKS URL | `CLERK_JWKS_URL` | Backend JWT validation | GitHub variable (public URL) + AWS SSM if needed | On Clerk key rotation |
| Clerk audience | `CLERK_AUDIENCE` | Backend JWT validation | GitHub secret / variable | On Clerk key rotation |
| Clerk issuer | `CLERK_ISSUER` | Backend JWT validation | GitHub variable (public URL) | On Clerk key rotation |
| LLM API key | `GEMINI_API_KEY` | AI assistant service (Gemini) | GitHub secret + AWS Secrets Manager | 90 days or on compromise |
| LLM model | `GEMINI_MODEL` | AI assistant model selection | GitHub variable | On model upgrade |
| Vercel token | `VERCEL_TOKEN` | Deploy workflow | GitHub secret | 90 days or on compromise |
| Vercel org ID | `VERCEL_ORG_ID` | Deploy workflow | GitHub secret | On org change |
| Vercel project IDs | `VERCEL_PROJECT_ID_*` | Deploy workflow | GitHub secret | On project recreation |
| Vercel Edge Config ID | `VERCEL_EDGE_CONFIG_ID` | Canary routing | GitHub secret | On config recreation |
| AWS OIDC role | `AWS_ROLE_ARN` | CI/CD AWS access | GitHub variable (trusts repo) | On policy change |
| Redis URL / auth | `REDIS_URL` | Rate limiting, quotas | GitHub environment secret + AWS Secrets Manager | 90 days |
| Feature flag tokens | `UNLEASH_API_TOKEN`, `MANAGED_FEATURE_FLAGS_TOKEN` | Feature flag providers | GitHub secret + provider console | 90 days |
| OTLP headers | `OTEL_EXPORTER_OTLP_HEADERS` | Observability exporter | GitHub secret | On token rotation |
| Object storage keys | `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | Logo/hero upload (future R2/S3) | AWS Secrets Manager / IAM role | 90 days |
| Preview token secret | `PREVIEW_TOKEN_SECRET` (future) | Preview token HMAC | AWS Secrets Manager | 90 days |
| CI test secret | `CI_SECRET_KEY` | CI security regression tests | GitHub repository secret | 90 days |

## Storage policy

### Local development

- Use `.env.example` as the template; never commit `.env`.
- Use Docker Compose defaults for Postgres/Redis only in development.
- `SECRET_KEY` in `.env.example` is `change-me-in-production`; `Settings` rejects this value when `ENV != development`.

### CI/CD

- **Repository-level secrets** apply to all environments (`CI_SECRET_KEY`, `VERCEL_TOKEN`, etc.).
- **Environment-level secrets** apply to `staging` and `production` (`STAGING_DATABASE_URL`, `PRODUCTION_DATABASE_URL`, etc.).
- Set secrets with the helper scripts:
  - `scripts/set-vercel-github-secrets.sh`
  - `scripts/set-github-secrets.sh`

### Production

- Production secrets live in **AWS Secrets Manager** (see `infra/secrets.tf`).
- Terraform variables for secrets are marked `sensitive = true`.
- Applications read secrets at startup via environment variables injected by Vercel or ECS.
- No secret may be logged, returned in error responses, or stored in `Revision.snapshot` / `IngestionJob.raw_payload`.

## Injection in CI/CD

### Backend tests and migrations

```yaml
env:
  DATABASE_URL: ${{ secrets.STAGING_DATABASE_URL }}
  SECRET_KEY: ${{ secrets.CI_SECRET_KEY }}
```

### Vercel deployments

```yaml
env:
  VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
  VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
  VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID_BACKEND }}
```

### AWS OIDC

CI/CD assumes an AWS role via OIDC; no long-lived AWS access keys are stored in GitHub:

```yaml
permissions:
  id-token: write
  contents: read

- uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: ${{ vars.AWS_ROLE_ARN }}
    aws-region: ${{ vars.AWS_REGION }}
```

## Rotation policy

| Trigger | Action |
|---|---|
| Scheduled (90 days) | Rotate `SECRET_KEY`, `DATABASE_URL` password, LLM keys, `VERCEL_TOKEN`, Redis auth, object-storage keys. |
| Employee offboarding | Rotate any secret the individual had access to. |
| Suspected compromise | Rotate immediately; revoke sessions; audit access logs. |
| Dependency breach | Rotate any secret that may have been exposed in build logs or artifacts. |

### Rotation procedure

1. Generate new secret in AWS Secrets Manager.
2. Update the corresponding GitHub secret/variable.
3. Redeploy affected services.
4. Revoke/expire the old secret after confirming health.
5. Update `docs/SECRETS_MANAGEMENT.md` rotation log.

## Secret redaction

The backend logger scrubs known sensitive keys. See `docs/SECURE_CODING_GUIDE.md` section 6 for the redaction processor. In addition:

- Terraform plan output is never logged in CI unless sanitized.
- Vercel build logs must not echo environment variables.
- CI job traces mask secrets automatically when stored in `secrets.*`.

## Compromise response

1. Rotate the affected secret immediately.
2. Revoke active sessions/tokens if the secret is auth-related (`SECRET_KEY`, Clerk keys).
3. Review audit logs and `security.*` events for unauthorized access.
4. Notify Security Champion and AppSec Engineering.
5. Follow `docs/RUNBOOKS/incident-response.md`.

## References

- `docs/THREAT_MODEL.md` T002, T011, T012
- `docs/SECURE_CODING_GUIDE.md` section 6
- `docs/APPSEC_PLAYBOOK.md`
- `infra/secrets.tf`
- `scripts/set-github-secrets.sh`
- `scripts/set-vercel-github-secrets.sh`
- `.env.example`
