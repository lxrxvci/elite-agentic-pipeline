# Elite Agentic Pipeline — User Guide

A step-by-step guide to using the Elite Agentic SDLC Pipeline: what it is, what it can do, and how it does it.

---

## Table of Contents

1. [What is this?](#what-is-this)
2. [What can it do?](#what-can-it-do)
3. [High-level architecture](#high-level-architecture)
4. [Setup](#setup)
5. [Local development workflow](#local-development-workflow)
6. [The SDLC stages](#the-sdlc-stages)
7. [Stage gates and feedback](#stage-gates-and-feedback)
8. [Agent dispatch and the orchestrator](#agent-dispatch-and-the-orchestrator)
9. [CI/CD in GitHub Actions](#cicd-in-github-actions)
10. [Deploying without AWS](#deploying-without-aws)
11. [Common commands cheat sheet](#common-commands-cheat-sheet)
12. [Troubleshooting](#troubleshooting)

---

## What is this?

The Elite Agentic Pipeline is a repeatable, agent-driven software delivery system. Instead of writing an app with one-off prompts, you give it a product brief and a squad of specialized AI agents proceeds through the full product lifecycle:

- Product strategy & UX research
- Shaping & scoping
- Architecture decisions (ADRs) & API design (RFCs)
- Design + build
- CI/CD
- Deploy & release
- Observe & improve

It produces a real, working full-stack application with tests, observability, infrastructure-as-code, security scanning, and DORA metrics.

**Current reference implementation:** `example_project/` is a freelancer SaaS dashboard (time tracking, invoicing, clients, projects).

---

## What can it do?

### Product & design
- Take a brief and run a discovery loop
- Shape bets with problem, appetite, solution, and no-gos
- Produce user flows, wireframes, and a design-system token file
- Generate OpenAPI-first API specs

### Engineering
- Generate a full-stack app:
  - Backend: FastAPI + SQLAlchemy + Pydantic + Alembic
  - Frontend: Next.js 15 + React 19 + TypeScript + Tailwind
- Write unit, integration, contract (Pact), E2E (Playwright), and a11y tests
- Enforce ≥80% backend test coverage
- Run linting, type-checking, and SAST (Bandit, Semgrep, Trivy, TruffleHog, CodeQL)

### Platform
- Provision AWS infrastructure with Terraform (VPC + RDS + IAM OIDC)
- Run CI/CD in GitHub Actions
- Deploy to Vercel with canary releases and auto-rollback
- Collect DORA metrics (deployment frequency, lead time, CFR, recovery time)
- Provide observability stack: Prometheus, Grafana, Loki, Tempo, Alertmanager

### Governance
- Block stage advancement until evidence (artifacts + passing gates) is present
- Track all work in `.pipeline/state.json`
- Aggregate feedback into `.pipeline/feedback.json` and `.pipeline/gates.json`

---

## High-level architecture

```
User brief
    │
    ▼
[Orchestrator]  ← pipeline/orchestrator.py
    │
    ├──► Product Strategist → Product Owner
    ├──► UX Researcher → UX Designer → UI Technologist
    ├──► Tech Lead → Frontend Engineer + Backend Engineer
    │              ADR/RFC        src/frontend/      src/backend/
    ├──► SDET → tests/ (unit + contract + E2E)
    ├──► DevOps/SRE → .github/workflows/ + infra/
    ├──► Security Champion → threat model + DevSecOps gates
    └──► Data Analyst → METRICS.md + DORA dashboard
```

### Key directories

| Directory | Purpose |
|-----------|---------|
| `pipeline/` | Orchestrator, agent prompts, workflow playbooks, platform modules |
| `pipeline/agents/` | Role prompts (18 roles) |
| `pipeline/workflows/` | Stage playbooks (one per SDLC stage) |
| `pipeline/platform/` | Scaffold, GitHub Actions templates, Terraform, design system |
| `example_project/` | Live reference implementation |
| `example_project/src/backend/` | FastAPI app |
| `example_project/src/frontend/` | Next.js app |
| `example_project/infra/` | Terraform AWS modules |
| `example_project/observability/` | Prometheus/Grafana/Tempo/Loki/Alertmanager configs |
| `example_project/.pipeline/` | Runtime state, feedback, gates, dispatch manifests |

### Default stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15 + React 19 + TypeScript + Tailwind |
| Backend | FastAPI + Python 3.12 + SQLAlchemy 2.0 + Pydantic v2 |
| Database | PostgreSQL (Docker locally; Neon/RDS in prod) |
| API | OpenAPI-first REST |
| State | TanStack Query (server), Zustand (client) |
| Testing | pytest, Vitest, Playwright, axe-core, Pact |
| CI/CD | GitHub Actions |
| Hosting | Vercel (frontend + backend serverless) |
| IaC | Terraform (AWS VPC + RDS) |
| Observability | OpenTelemetry + Prometheus + Grafana/Tempo/Loki |

---

## Setup

### 1. Install pipeline tooling

From the repository root:

```bash
cd /Users/lxrxcvi/sdlc-pipeline/elite-agentic-pipeline
make setup-pipeline
```

This creates a root `.venv` and installs pipeline tooling (pytest, ruff, mypy).

### 2. Set up the example project

```bash
cd example_project
cp .env.example .env
make setup
```

This installs:
- Python dependencies into `src/backend/.venv`
- Node dependencies into `src/frontend/node_modules`

### 3. Start the local stack

```bash
docker compose up --build
```

After it boots:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000/api/v1
- API docs: http://localhost:8000/docs

The compose file starts PostgreSQL, Redis, backend, and frontend.

---

## Local development workflow

### Run quality checks

```bash
cd example_project
make ci
```

This runs:
- Backend ruff + mypy + pytest
- Frontend lint + typecheck + tests

### Run specific test suites

```bash
make test                 # backend + frontend unit tests
make test-contracts       # Pact contract tests
make test-e2e             # Playwright E2E
```

### Collect feedback and check gates

```bash
make feedback             # writes .pipeline/feedback.json + gates.json
make check                # orchestrator prints current stage + gates
```

### Advance the pipeline (manually or automatically)

```bash
make advance-auto         # advance only if all gates pass
make advance              # advance unconditionally
```

Or use the orchestrator directly:

```bash
python3 ../pipeline/orchestrator.py --project-dir . status
python3 ../pipeline/orchestrator.py --project-dir . check
python3 ../pipeline/orchestrator.py --project-dir . advance --auto
```

---

## The SDLC stages

The pipeline moves linearly through seven stages:

```
init → discovery → shaping → rfc_adr → design_build → ci_cd → deploy_release → observe_improve
```

| Stage | What happens | Key artifacts |
|-------|--------------|---------------|
| **discovery** | Research the problem space, identify opportunities | `docs/OPPORTUNITY_SOLUTION_TREE.md` |
| **shaping** | Define shaped bets with appetite, solution, no-gos | `docs/SHAPED_BETS.md` |
| **rfc_adr** | Decide architecture and API contracts | `docs/adr/`, `openapi.yaml` |
| **design_build** | Design UX/UI and implement features behind flags | `src/backend/`, `src/frontend/`, `docs/THREAT_MODEL.md`, `docs/TEST_STRATEGY.md` |
| **ci_cd** | Harden CI/CD, sign artifacts, tag deployment candidate | `.github/workflows/`, passing CI |
| **deploy_release** | Deploy to staging, canary to production, smoke, rollback if needed | Vercel URLs, `METRICS.md` |
| **observe_improve** | Track SLOs, DORA, user feedback, iterate | `docs/SLOs.md`, `dora-metrics.prom` |

The orchestrator enforces required artifacts before allowing advancement. For example, you cannot advance past `rfc_adr` without an accepted ADR and `openapi.yaml`.

---

## Stage gates and feedback

Gates are booleans stored in `example_project/.pipeline/gates.json`. They tell you whether the current stage is “done” from an evidence perspective.

| Gate | How it is evaluated |
|------|---------------------|
| `discovery` | Always `true` |
| `shaping` | Always `true` |
| `rfc_adr` | Always `true` |
| `design_build` | Backend & frontend tests pass; backend coverage ≥80% |
| `ci_cd` | Backend & frontend lint/typecheck pass; backend Bandit passes |
| `deploy_release` | `.security-feedback.json` exists and all SAST/DAST checks passed |
| `observe_improve` | `dora-metrics.prom` exists |

### Feedback files

| File | Produced by | Purpose |
|------|-------------|---------|
| `.pipeline/feedback.json` | `scripts/ci_feedback.py` | Full feedback report |
| `.pipeline/gates.json` | `scripts/ci_feedback.py --write-gates` | Per-stage booleans |
| `src/backend/.ci-feedback.json` | CI or local `ci_feedback.py` | Backend lint/type/test/bandit |
| `src/frontend/.ci-feedback.json` | CI or local `ci_feedback.py` | Frontend lint/type/test |
| `.security-feedback.json` | `_security-scan.yml` in CI | SAST/SCA/secrets results |
| `dora-metrics.prom` | `dora-metrics.yml` | DORA metrics |

### Local vs CI

- **Locally**, if `.security-feedback.json` is missing, the `deploy_release` gate is `false` by design. This prevents you from accidentally thinking you can deploy without a CI security scan.
- **In CI**, the Security workflow writes `.security-feedback.json` after all scans pass, so downstream deploy jobs can read it.

You can override this for local exploration by creating a stub file, but you should not commit it:

```bash
cd example_project
cat > .security-feedback.json <<'EOF'
{
  "status": "collected",
  "checks": {
    "bandit": {"passed": true},
    "semgrep": {"passed": true},
    "trivy": {"passed": true},
    "dependency_review": {"passed": true},
    "trufflehog": {"passed": true},
    "codeql": {"passed": true}
  }
}
EOF
make feedback
```

---

## Agent dispatch and the orchestrator

The orchestrator (`pipeline/orchestrator.py`) is the state machine that drives the pipeline.

### Useful commands

```bash
# Initialize a new project from a brief
python3 pipeline/orchestrator.py --project-dir example_project init --brief "..."

# Show the current stage and recommended next actions
python3 pipeline/orchestrator.py --project-dir example_project run

# Check current stage + gates
python3 pipeline/orchestrator.py --project-dir example_project check

# Advance to the next stage
python3 pipeline/orchestrator.py --project-dir example_project advance

# Advance only if gates pass
python3 pipeline/orchestrator.py --project-dir example_project advance --auto

# Force advancement to a specific stage
python3 pipeline/orchestrator.py --project-dir example_project advance --to design_build --force
```

### How agent dispatch works

1. **Prepare:** `loop --prepare --dispatch` writes one manifest per agent into `.pipeline/dispatch/<role>.md`.
2. **Run agents:** A parent AI (you, or the Kimi skill in `.kimi/skills/elite-pipeline/SKILL.md`) invokes each agent. Agents read their manifest and write project files.
3. **Complete:** `loop --complete` marks manifests done, refreshes feedback, checks gates, and auto-advances if everything passes.

Example manual cycle:

```bash
python3 pipeline/orchestrator.py --project-dir example_project loop --prepare --dispatch
# ... invoke agents ...
python3 pipeline/orchestrator.py --project-dir example_project loop --complete
```

In practice, the Kimi skill automates this cycle for you.

---

## CI/CD in GitHub Actions

When you push to `main` or open a PR, these workflows run:

| Workflow | What it does |
|----------|--------------|
| `ci.yml` | Lint, test, E2E, infra validation, DORA collection |
| `_ci-backend.yml` | Backend ruff, mypy, bandit, migrations, pytest |
| `_ci-frontend.yml` | Frontend lint, typecheck, tests, a11y, build |
| `_ci-e2e-real.yml` | Real-backend Playwright E2E tests |
| `_ci-infra.yml` | Terraform init/validate/plan + Checkov |
| `security.yml` | Bandit, Semgrep, Trivy, dependency review, TruffleHog, CodeQL |
| `contract-tests.yml` | Pact consumer + provider contract tests |
| `drift-check.yml` | Ensures `example_project/.github/workflows` stays synced with `pipeline/platform/github_actions` |
| `deploy.yml` | Staging → production canary deploy (triggered after CI + Security succeed) |

### Deployment flow

```
CI + Security succeed on main
        │
        ▼
   Deploy gate check
        │
        ▼
  Migrate staging DB
        │
        ▼
  Deploy backend + frontend to staging
        │
        ▼
     Smoke tests
        │
        ▼
  Migrate production DB
        │
        ▼
  Backend canary (5%)
        │
        ▼
  Canary analysis
        │
        ▼
  Promote canary / rollback
        │
        ▼
  Production frontend deploy
        │
        ▼
  Production smoke tests
```

---

## Deploying without AWS

Yes — you can use the pipeline without AWS.

### What works without AWS

- Local development and testing
- CI workflow (lint, test, E2E, infra validation)
- Security workflow
- Contract tests
- Drift check

### What needs cloud credentials

The only AWS-dependent parts are:
- Terraform apply (RDS, VPC, IAM) — but `_ci-infra.yml` skips AWS credential setup if `vars.AWS_ROLE_ARN` is empty.
- Production/staging deployments, which today target **Vercel**.

To deploy without AWS, you need Vercel secrets rather than AWS:
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID_BACKEND_STAGING`
- `VERCEL_PROJECT_ID_FRONTEND_STAGING`
- `STAGING_DATABASE_URL` / `PRODUCTION_DATABASE_URL` (can point to Neon, Supabase, etc.)

If you do not set these, the Deploy workflow will fail/skipped, but all other quality workflows remain green.

### Fully local deployment alternative

If you just want to see the app running, use Docker Compose:

```bash
cd example_project
docker compose up --build
```

This gives you a working local instance with PostgreSQL and Redis, no cloud required.

---

## Common commands cheat sheet

### From repository root

```bash
make help                    # list all targets
make setup-pipeline          # install pipeline tooling
make init BRIEF="..."        # initialize a project from a brief
make lint-pipeline           # lint pipeline code
make test-pipeline           # run pipeline tests
make infra-plan              # plan platform Terraform
make sync-scaffold           # copy example_project back into scaffold
```

### From example_project

```bash
make setup                   # install backend + frontend deps
make ci                      # run all local CI checks
make test                    # run unit tests
make test-contracts          # run Pact contract tests
make test-e2e                # run Playwright E2E
make feedback                # refresh feedback + gates
make check                   # orchestrator check
make advance-auto            # advance if gates pass
make migrate                 # run Alembic migrations
```

### Direct orchestrator usage

```bash
python3 ../pipeline/orchestrator.py --project-dir . status
python3 ../pipeline/orchestrator.py --project-dir . run
python3 ../pipeline/orchestrator.py --project-dir . check
python3 ../pipeline/orchestrator.py --project-dir . advance --auto
python3 ../pipeline/orchestrator.py --project-dir . advance --to <stage> --force
```

---

## Troubleshooting

### `make collect` shows `design_build=false`

Usually means stale test state. The feedback script now uses a fresh SQLite DB per run. If it still fails, run:

```bash
cd example_project
source src/backend/.venv/bin/activate
python3 scripts/ci_feedback.py --project-dir . --write-gates
```

### `deploy_release` gate is false locally

Expected. `.security-feedback.json` is only created by the Security workflow in CI. For local exploration, create a stub file (see [Stage gates and feedback](#stage-gates-and-feedback)).

### Deploy workflow fails

Expected until you provision:
- AWS IAM OIDC provider + `vars.AWS_ROLE_ARN` (or skip AWS by leaving it empty)
- Vercel secrets
- Database URLs

### E2E tests fail locally

Make sure Docker Compose is running and the backend is healthy:

```bash
cd example_project
docker compose up -d backend
curl http://localhost:8000/health
npm run test:e2e
```

### Drift check fails

Run:

```bash
make sync-scaffold
```

If `pipeline/platform/github_actions` is out of sync, manually copy the changed `_*.yml` files from `example_project/.github/workflows/` to `pipeline/platform/github_actions/`.
