# Repository Governance

## Branch Protection (main)

Branch protection for `main` is managed as code by `infra/main.tf` via the `github_branch_protection.main` resource when `var.enable_github_protection` is `true`. The resource requires:

- 1 approving reviewer
- Dismiss stale reviews when new commits are pushed
- `ci`, `security`, and `contract-tests` status checks to pass
- Administrators are also subject to these rules

Configure these rules in GitHub repository settings if Terraform management is disabled:

- **Require a pull request before merging**
  - Require approvals: 1
  - Dismiss stale PR approvals when new commits are pushed
  - Require review from CODEOWNERS
- **Require status checks to pass before merging**
  - `ci`
  - `security`
  - `contract-tests`
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

## Merge Queue

Enable GitHub Merge Queue for `main` so pull requests are re-tested against the latest target branch before merging. This prevents semantic conflicts when multiple PRs merge close together.

### Manual enablement

In GitHub repository settings → Branches → `main` protection rule:

1. Check **Require merge queue**.
2. Set **Merge method** to **Squash and merge**.
3. Set **Build concurrency** to `5` (default).
4. Ensure the required status checks (`ci`, `security`, `contract-tests`) are also required in the merge queue.

### As code with `github_repository_ruleset`

If you prefer rulesets over the classic branch protection resource, add a `github_repository_ruleset` resource (requires `integrations/github` provider ~> 6.0):

```hcl
resource "github_repository_ruleset" "main_merge_queue" {
  name        = "main-merge-queue"
  repository  = var.github_repo
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }

  rules {
    required_linear_history = true
    required_signatures     = true

    pull_request {
      dismiss_stale_reviews_on_push     = true
      require_code_owner_review         = true
      required_approving_review_count   = 1
      required_review_thread_resolution = true
    }

    required_status_checks {
      strict_required_status_checks_policy = true
      required_check {
        context = "ci"
      }
      required_check {
        context = "security"
      }
      required_check {
        context = "contract-tests"
      }
    }

    merge_queue {
      merge_method = "SQUASH"
    }
  }
}
```

Note: Do not use both `github_branch_protection.main` and a ruleset for the same protections simultaneously, or Terraform will fight over the settings. Choose one approach per repository.

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
| `TF_VAR_DB_PASSWORD` | infra.yml, pr-environment.yml |
| `TERRAFORM_BACKEND_CONFIG` | infra.yml, pr-environment.yml (contents of `infra/backend.tfvars`) |
| `CLERK_JWKS_URL` | backend runtime |
| `CLERK_AUDIENCE` | backend runtime |

See `docs/RUNBOOKS/secrets.md` for a per-environment checklist and rotation guidance.

## Required GitHub Variables

| Variable | Purpose |
|---|---|
| `STAGING_API_URL` | Frontend build-time API URL |
| `STAGING_FRONTEND_URL` | DAST target URL |
| `PRODUCTION_BACKEND_URL` | Smoke tests / rollback health checks |
| `PRODUCTION_FRONTEND_URL` | Smoke tests / rollback health checks |
| `PROMETHEUS_URL` | Production Prometheus URL for SLO gate (optional) |
| `AWS_ROLE_ARN` | ARN of the IAM role CI/CD assumes via OIDC |
| `AWS_REGION` | AWS region for CI/CD OIDC sessions (defaults to `us-east-1`)

## Teams

Replace placeholder CODEOWNERS teams with real GitHub teams:

- `@elite-platform/backend`
- `@elite-platform/frontend`
- `@elite-platform/platform`
- `@elite-platform/security` (for threat-model and security-runbook changes)

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
