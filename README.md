# Elite Agentic SDLC Pipeline

> Build market-ready software the way elite product firms do — with a cross-functional agent squad, DORA-grade delivery practices, and a Vercel-only deploy pipeline to staging and production.

> Status: Phase 3 complete. Vercel projects and Neon databases provisioned; CI/CD running on GitHub Actions. — with a cross-functional agent squad, DORA-grade delivery practices, and Kimi 2.7 Code as the execution engine.

## Quick start

```bash
# 1. Clone or open this project in Kimi Code CLI
# 2. Initialize a new product
python pipeline/orchestrator.py --project-dir example_project init --brief "A SaaS dashboard that helps freelancers track time, invoice clients, and get paid faster."

# 3. Run the delivery loop
python pipeline/orchestrator.py --project-dir example_project run
```

To work on the scaffold code itself, install dependencies first with `make setup`, then run `make lint`, `make test`, etc.

The orchestrator will spin up the agent squad and walk through:
1. Continuous discovery & product shaping
2. RFC/ADR and OpenAPI-first API design
3. UI/UX design with design tokens
4. Full-stack implementation with TDD
5. CI/CD, feature flags, and canary deployment
6. Observability, DORA metrics, and continuous improvement

## What makes this different

- **Agents are team members**, not tools. Each has a role, responsibilities, and handoff criteria derived from elite engineering organizations (Google, Amazon, Netflix, Stripe, Spotify, Meta, Shopify).
- **The SDLC is the product.** The pipeline implements continuous discovery, trunk-based development, shift-left testing, platform engineering, and SRE practices as first-class concerns.
- **Decisions are explicit.** Architecture Decision Records (ADRs), RFCs, and a North Star metric keep every choice visible and reversible.
- **Quality is built in.** TDD, diff coverage, contract testing, E2E with Playwright, SAST/SCA/SCA, and chaos-engineering playbooks.
- **Metrics drive improvement.** DORA, flow, HEART, Core Web Vitals, and security metrics are tracked from day one.

## Architecture overview

See `AGENTS.md` for the full agent operating model.

```
User brief
    │
    ▼
[Orchestrator]
    │
    ├──► Product Strategist  ──► Product Owner
    │                              │
    ├──► UX Researcher ──► UX Designer ──► UI Technologist
    │                              │
    ├──► Tech Lead ──► Frontend Engineer ──► Backend Engineer
    │       │                │                    │
    │       ▼                ▼                    ▼
    │     ADR/RFC      src/frontend/         src/backend/
    │     OpenAPI spec        │                    │
    │                         └────────┬───────────┘
    │                                  ▼
    ├──► SDET ──► tests/ (unit + contract + E2E)
    │
    ├──► DevOps/SRE ──► .github/workflows/ + infra/
    │
    ├──► Security Champion ──► threat model + DevSecOps gates
    │
    └──► Data Analyst ──► METRICS.md + DORA dashboard
```

## Documentation

- `pipeline/agents/` — role prompts for every agent
- `pipeline/workflows/` — SDLC workflow playbooks
- `pipeline/templates/` — reusable artifact templates (ADR, RFC, runbook, post-mortem)
- `pipeline/platform/scaffold/` — Golden Path starter code
- `pipeline/platform/github_actions/` — reusable CI/CD workflow templates
- `pipeline/platform/terraform/` — base infrastructure modules
- `pipeline/platform/design_system/` — design tokens and component specs

## Contributing

This pipeline is itself a product. Improvements should follow the same loop: discovery → shaping → RFC → build → deploy → observe. Update ADRs when changing architectural conventions.
