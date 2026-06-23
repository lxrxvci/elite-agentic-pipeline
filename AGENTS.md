# Agent Guidance: Elite Agentic SDLC Pipeline

## What this project is

A Kimi Code CLI-native operating system that builds market-ready full-stack web applications like an elite software product firm. The pipeline is implemented as a squad of specialized agents plus a shared platform layer. Every agent has a role prompt under `pipeline/agents/`, follows DORA-validated practices, and contributes to a continuous delivery loop.

## Core principles

1. **Pragmatism beats doctrine.** Every major decision is captured in an ADR. Choose boring technology by default; spend innovation tokens only when justified.
2. **Cognitive load is the constraint.** Platform agents provide Golden Paths so stream-aligned squad agents focus on product value.
3. **Decouple everything.** Feature flags separate deploy from release; OpenAPI separates frontend from backend; bounded contexts separate teams; contract tests separate service validation.
4. **Feedback loops are the product.** Continuous discovery, CI on every commit, canary observability, and blameless post-mortems.
5. **Small, empowered squads.** A stream-aligned squad owns an outcome end-to-end with minimal cross-team dependencies.
6. **Quality is owned by builders.** The SDET and CI gates keep quality close to the code author; QA Enablement sets standards and templates; it does not gatekeep.
7. **Everything is continuous.** Discovery, integration, deployment, testing, monitoring, and improvement are part of daily work, not separate phases.

## How to use this pipeline

1. Start with the orchestrator: `python pipeline/orchestrator.py --project-dir example_project init --brief "your product idea"`.
2. The orchestrator dispatches squad agents in order, creating artifacts in the project workspace.
3. Review human-in-the-loop checkpoints: shaped bet, RFC, design, release.
4. When the loop finishes, you have a scaffolded app, tests, CI/CD, and observability baseline.

## Repository layout

```
pipeline/
  agents/          # Role prompts for each squad/platform agent
  platform/        # Golden Path scaffolds, CI templates, IaC modules
  workflows/       # SDLC workflow playbooks
  templates/       # Reusable artifact templates
  orchestrator.py  # Main driver
```

## Default Golden Path stack

- TypeScript (strict)
- React + Next.js (App Router)
- Python + FastAPI (or NestJS for Node-only teams)
- PostgreSQL
- OpenAPI-first REST
- TanStack Query (server state), Zustand (client state)
- Tailwind CSS + design tokens
- Vitest + Playwright + axe-core (contract testing with Pact is a Phase 2 addition)
- GitHub Actions + Vercel/Fly.io (deployment targets must be configured per project)
- Terraform (Pulumi is an optional future alternative)
- OpenTelemetry + Prometheus (Grafana dashboards are a Phase 3 addition)

## Repository guardrails

- **Branch protection is required.** Configure `main` with required status checks (`ci`, `security`, `contract-tests`), required PR reviews, and a merge queue. Treat `CODEOWNERS` as the source of truth for reviewer routing.
- **No production secrets in CI.** Use OIDC federation where possible; otherwise use repository secrets (e.g., `CI_SECRET_KEY`) instead of hardcoded values.
- **Generated projects must keep `.gitignore` intact.** Build outputs, dependency directories, and generated pacts must not be committed.

## Key metrics

Track DORA (deployment frequency, lead time, change failure rate, recovery time), flow metrics (WIP, cycle time, throughput), and UX metrics (HEART + Core Web Vitals).
