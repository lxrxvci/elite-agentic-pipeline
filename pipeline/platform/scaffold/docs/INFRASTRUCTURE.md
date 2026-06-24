# Infrastructure

This project uses Terraform to manage the AWS resources that support the Elite application. The main module lives in `infra/` and the remote-state bootstrap module lives in `infra/bootstrap/`.

## Layout

| File / Directory | Purpose |
|---|---|
| `infra/main.tf` | VPC, RDS PostgreSQL, ElastiCache Redis, IAM OIDC role, branch protection |
| `infra/secrets.tf` | Secrets Manager secret for the database password |
| `infra/pr-environment.tf` | Optional ephemeral resources for PR/preview Terraform workspaces |
| `infra/variables.tf` | Input variables, including `enable_github_protection` and `enable_pr_environments` |
| `infra/outputs.tf` | Connection strings, role ARNs, and preview resource names |
| `infra/backend.tf` | Partial S3 backend configuration |
| `infra/backend.tfvars.example` | Example backend variables (copy to `backend.tfvars`) |
| `infra/bootstrap/` | One-time S3 bucket + DynamoDB table for Terraform remote state |

## GitHub Actions OIDC

CI/CD workflows authenticate to AWS without long-lived access keys. The `aws_iam_role.github_actions` role trusts the GitHub Actions OIDC provider (`token.actions.githubusercontent.com`) and is constrained to this repository.

Store the role ARN in a GitHub variable:

- `AWS_ROLE_ARN` — output value of `github_actions_role_arn`

Workflows use `aws-actions/configure-aws-credentials` with `role-to-assume: ${{ vars.AWS_ROLE_ARN }}`.

## Branch Protection as Code

The `github_branch_protection.main` resource enforces the following rules on the default branch when `enable_github_protection` is `true` (the default):

- At least one approving reviewer
- Dismiss stale reviews when new commits are pushed
- Require the `ci` and `security` status checks to pass
- Enforce administrators

To disable Terraform management of branch protection (for example, while setting up a new repository), set:

```hcl
enable_github_protection = false
```

The rules are still documented in `docs/REPO_GOVERNANCE.md` and should be mirrored in GitHub repository settings if not managed by Terraform.

## PR / Preview Environments

Lightweight preview environments can be created as separate Terraform workspaces. They are controlled by the `enable_pr_environments` variable.

### How it works

1. When `enable_pr_environments = true`, the resources in `infra/pr-environment.tf` are created only in non-default workspaces.
2. A dedicated GitHub Actions workflow (`.github/workflows/pr-environment.yml`) creates a workspace named `pr-<number>`, runs `terraform apply`, and destroys the workspace and its resources when the PR is closed.
3. Preview resources are intentionally small (an S3 bucket and a DynamoDB table) so they can be created and destroyed quickly and cheaply.

### Manual usage

```bash
cd infra
terraform workspace new pr-123
terraform plan -var="enable_pr_environments=true" -var="db_password=$DB_PASSWORD"
terraform apply -var="enable_pr_environments=true" -var="db_password=$DB_PASSWORD"

# When the preview is no longer needed:
terraform destroy -var="enable_pr_environments=true" -var="db_password=$DB_PASSWORD"
terraform workspace select default
terraform workspace delete pr-123
```

## Terraform Plan / Apply in CI

The `.github/workflows/infra.yml` workflow manages infrastructure continuously:

- **Pull requests** targeting `main` that touch `infra/**` or `observability/**` trigger `terraform plan`. The plan is posted as a PR comment.
- **Pushes** to `main` trigger `terraform plan` followed by `terraform apply`. Apply requires approval through the `production` GitHub environment.

The workflow uses OIDC for AWS credentials and expects:

- `vars.AWS_ROLE_ARN`
- `vars.AWS_REGION` (defaults to `us-east-1`)
- `secrets.TERRAFORM_BACKEND_CONFIG` (contents of `backend.tfvars`)
- `secrets.TF_VAR_DB_PASSWORD` (value for the `db_password` Terraform variable)

## Static Analysis / Checkov

The reusable `_ci-infra.yml` workflow runs Checkov against `infra/`. Known acceptable risks are suppressed inline with `#checkov:skip=<id>:<justification>` comments. Do not disable the Checkov scan; fix new findings or add a documented suppression.

Other validation performed by `_ci-infra.yml`:

- `terraform fmt -check`
- `terraform validate`
- Presence of `.terraform.lock.hcl`
- Presence and shape of `backend.tfvars.example`
- Prometheus alert rules (`promtool check rules`)
- Alertmanager configuration (`amtool check-config`)

## Local Development

```bash
cd infra
terraform init -backend=false
terraform fmt -recursive
terraform validate
```

To plan against the real backend:

```bash
cp backend.tfvars.example backend.tfvars
# edit backend.tfvars with your bucket/table/region
terraform init -backend-config=backend.tfvars
terraform plan -var="db_password=$DB_PASSWORD"
```
