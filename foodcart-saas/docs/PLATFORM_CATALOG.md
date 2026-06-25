# Platform Catalog — Foodcart SaaS

This catalog lists the reusable platform assets this squad consumes. It is
maintained by the Platform Engineer and updated whenever the squad adopts a new
Golden Path or reusable module.

## Reusable GitHub Actions

Stored in `../pipeline/platform/github_actions/` (relative to this project) and
consumed by the squad's `.github/workflows/` instances.

| Workflow | Purpose | Foodcart customizations |
|---|---|---|
| `_ci-backend.yml` | Backend lint, type check, SAST, migrations, and tests with PostgreSQL service. | `project-dir` set to `.`; optional Clerk/Redis/OpenAI/Anthropic secrets; coverage scoped via `pyproject.toml`; coverage XML/HTML/JSON artifacts uploaded. |
| `_ci-frontend.yml` | Frontend install, audit, lint, typecheck, unit tests, a11y, and build. | `project-dir` set to `.`; public build variables (`NEXT_PUBLIC_API_URL`) injected per environment; coverage artifact uploaded. |
| `_ci-e2e-real.yml` | Starts the real backend via Docker Compose and runs Playwright against it. | `project-dir` set to `.`; compose service `backend`; health endpoint `http://localhost:8000/health`; Playwright project `real-backend`. |
| `_ci-infra.yml` | Terraform fmt/validate, Checkov, Prometheus alert rule validation. | `project-dir` set to `.`; verifies `.terraform.lock.hcl` and `backend.tfvars.example`; Checkov SARIF output. |
| `security.yml` | Orchestrates SAST (bandit), SCA (`npm audit`), Semgrep, dependency review, secret scanning (TruffleHog), and Terraform posture (Checkov). | Runs against `src/backend`, `src/frontend`, and `infra`. |
| `contract-tests.yml` | Consumer contract tests in frontend; provider verification in backend with pact artifacts. | Uses Foodcart pact directory `src/frontend/pacts` and contract tests in `src/frontend/src/__contracts__`. |
| `deploy.yml` | Staging → canary → production deploy with Vercel, database migrations, and automated rollback. | Subdomain smoke tests; Vercel Edge Config canary routing via `scripts/update_edge_config_canary.py`; Foodcart-specific environment variables and project IDs. |

## Reusable Terraform Modules

Stored in `../pipeline/platform/terraform/modules/`. Document-only for this
cycle; not provisioned automatically by CI.

| Module | Purpose | Foodcart relevance |
|---|---|---|
| `modules/object-storage` | S3-compatible bucket + CDN for tenant-uploaded images. | Stores logos, hero images, and menu photos with tenant-prefixed keys and presigned URLs. |
| `modules/subdomain-routing` | Wildcard DNS, ACM certificate, and Vercel routing notes for multi-tenant subdomains. | Powers `slug.foodcartsite.com` routing and documents Edge Config canary tokens. |

## Scaffolds

| Asset | Location | Status |
|---|---|---|
| Next.js frontend starter | `../pipeline/platform/scaffold/frontend/` | Reused from Elite scaffold |
| FastAPI backend starter | `../pipeline/platform/scaffold/backend/` | Reused from Elite scaffold |
| PostgreSQL migrations | `../pipeline/platform/scaffold/database/` | Reused from Elite scaffold |
| Observability stack | `observability/` | Squad-local instance derived from scaffold |

## Platform services consumed

| Service | Provider | Squad usage |
|---|---|---|
| CI/CD compute | GitHub Actions | Runs reusable workflows above. |
| Identity & access | Clerk | JWT sessions, user/org provisioning, webhooks. |
| Feature flags | Unleash | Template rollouts, AI assistant, ingestion sources. |
| Hosting / edge | Vercel | Frontend, backend serverless functions, Edge Config, wildcard domains. |
| Object storage | AWS S3 / Cloudflare R2 (future) | Tenant image assets. |
| Database | AWS RDS PostgreSQL | Tenant-scoped relational data. |
| Cache & queues | AWS ElastiCache Redis | Rate limiting, tenant quotas, background ingestion jobs. |

## Feedback channels

- Open a platform request issue with the `platform` label.
- Mention `@platform-engineer` in ADRs/RFCs that introduce new infrastructure
  or CI needs.
- Security and compliance concerns should also involve `@appsec-engineering`.

## Last reviewed

2026-06-24 by Platform Engineer during CI/CD stage.
