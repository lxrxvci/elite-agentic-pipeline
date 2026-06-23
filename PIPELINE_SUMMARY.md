# Pipeline Summary

This is the **Elite Agentic SDLC Pipeline** — a Kimi Code CLI-native operating system for building market-ready full-stack web applications like an elite product firm.

## What was built

### 1. Agent team (18 role prompts)
- **Stream-aligned squad** (13 roles): Product Strategist, Product Owner, UX Researcher, UX Designer, UI Technologist, Tech Lead, Frontend Engineer, Backend Engineer, SDET, DevOps/SRE, Security Champion, Data Analyst, TPM.
- **Platform / enabling teams** (5 roles): Platform Engineer, DesignOps, QA Enablement, SRE Platform, AppSec Engineering.

Each agent prompt defines mandate, inputs, outputs, rules, interaction model, and tone.

### 2. SDLC workflow playbooks (7)
- Continuous Discovery Loop
- Shaping & Betting
- RFC & ADR
- Design & Build
- CI/CD
- Deploy & Release
- Observe & Improve

### 3. Artifact templates
- ADR
- RFC
- Backlog item
- Runbook
- Post-mortem

### 4. Golden Path scaffold
- **Frontend**: Next.js + React + TypeScript + Tailwind + TanStack Query + Zustand + Vitest.
- **Backend**: FastAPI + Python + SQLAlchemy + PostgreSQL + pytest.
- **Database**: PostgreSQL schema starter + migration placeholders.
- **Design system**: Token-based architecture (`tokens.json`).

### 5. Platform templates
- Starter GitHub Actions CI/CD workflows (`ci.yml`, `security.yml`, `deploy.yml`) in the scaffold.
- Terraform base module for AWS VPC + RDS PostgreSQL, copied into generated projects as `infra/`.

### 6. Orchestrator
`pipeline/orchestrator.py` manages project state and guides the squad through stages:
- `init --brief "..."` — create project workspace and copy scaffold
- `run` — show current stage workflow and recommended agent invocations
- `advance [--to stage]` — move to next SDLC stage
- `status` — show project state

## Demo run

A live demo was executed for the brief:

> "A SaaS dashboard that helps freelancers track time, invoice clients, and get paid faster."

The agent squad produced:
- `NORTH_STAR.md`, `PRODUCT_STRATEGY.md`, `ROADMAP.md` (Now/Next/Later)
- `DISCOVERY/` with personas, job stories, interview synthesis, OST, assumptions, and interview notes
- `BACKLOG.md`, `CAPACITY_PLAN.md`, `docs/SHAPED_BETS.md`
- `docs/adr/0001-choose-default-stack.md`, `docs/adr/0002-domain-boundaries.md`
- `docs/rfc/0001-first-bet.md`, `docs/SPIKE_LOG.md`, `docs/TECHNICAL_RISK_REGISTER.md`, `docs/DEPENDENCY_MAP.md`
- `openapi.yaml` — full API contract for Bet 1
- `design/` — user flows, wireframes, usability test plan, accessibility checklist, hi-fi prototypes, dev handoff
- `design-system/components/` — 12 component specs

## How to use it

```bash
cd elite-agentic-pipeline

# Create a new product
python pipeline/orchestrator.py init --brief "Your product idea here"

# See what the squad should do next
python pipeline/orchestrator.py --project-dir example_project run

# Advance when ready
python pipeline/orchestrator.py --project-dir example_project advance

# Check state
python pipeline/orchestrator.py --project-dir example_project status
```

In Kimi Code CLI, use the `Agent` tool to dispatch the recommended agent with its role prompt loaded from `pipeline/agents/<role>.md`.

## Next steps (Phase 2+)

1. **Implement Bet 1** — dispatch Frontend Engineer + Backend Engineer + SDET against the OpenAPI spec and design handoff.
2. **Add CI/CD agents** — DevOps/SRE sets up GitHub Actions, ephemeral environments, and Vercel/Fly deployment.
3. **Add security gates** — Security Champion runs threat modeling; AppSec Engineering integrates SAST/SCA.
4. **Observability** — SRE Platform and Data Analyst set up OpenTelemetry, SLOs, and DORA dashboard.
5. **Continuous improvement** — run weekly reviews and blameless post-mortems.

## Design principles

- **Pragmatism over orthodoxy** — ADRs capture every major choice.
- **Cognitive-load reduction** — Golden Paths let squad agents focus on product value.
- **Decoupling** — OpenAPI-first, feature flags, bounded contexts, contract tests.
- **Feedback-loop density** — continuous discovery, CI on every commit, canary observability.
- **Empowered small squads** — 5–9 agents own outcomes end-to-end.
- **Quality ownership inversion** — SDET and CI gates keep quality close to the code.
- **Everything continuous** — no hard phase gates.
