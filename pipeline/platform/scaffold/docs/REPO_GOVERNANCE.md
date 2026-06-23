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

## GitHub Actions Standards

- All third-party actions must be pinned to a commit SHA (e.g., `actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4`).
- Keep the semantic version comment after the SHA for readability.
- Do not use floating tags (`@v4`, `@v3`) in workflow files.

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
| `STAGING_FRONTEND_URL` | DAST target URL |
| `PRODUCTION_BACKEND_URL` | Smoke tests / rollback health checks |
| `PRODUCTION_FRONTEND_URL` | Smoke tests / rollback health checks |
| `PROMETHEUS_URL` | Production Prometheus URL for SLO gate (optional) |

## Teams

Replace placeholder CODEOWNERS teams with real GitHub teams:

- `@elite-squad/backend`
- `@elite-squad/frontend`
- `@elite-squad/platform`

## Terraform Remote State Backend

The example project uses an S3 backend for Terraform state. The backend is configured in
`infra/backend.tf` as a partial configuration; runtime values are supplied via
`infra/backend.tfvars`.

### Bootstrapping

1. Enter the bootstrap module and plan/apply it once with local state:

   ```bash
   cd infra/bootstrap
   terraform init
   terraform plan -var="state_bucket_name=elite-terraform-state" -var="lock_table_name=elite-terraform-locks"
   terraform apply
   ```

2. Copy the example backend variables:

   ```bash
   cd ../
   cp backend.tfvars.example backend.tfvars
   # Edit backend.tfvars to match the bucket and table created above.
   ```

3. Initialize the main infrastructure with the remote backend:

   ```bash
   terraform init -backend-config=backend.tfvars
   ```

Do not commit `backend.tfvars` or any local `.terraform/` state.

## Image Scanning Policy

The `image-scan` job in `_security-scan.yml` builds the backend and frontend production images and
scans them with Trivy for CRITICAL and HIGH vulnerabilities that have a published fix
(`ignore-unfixed: true`). Findings block the Security workflow and therefore production deployment.

To handle accepted risks, add a `.trivyignore` file at the repository root with a comment
explaining each exception. Do not silently ignore classes of vulnerabilities.

## Dependency Graph

Enable **Dependency graph** and **Dependabot alerts** in repository settings so `dependency-review-action` can run.
