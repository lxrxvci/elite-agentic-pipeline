# ADR {{number}}: Deployment Targets

## Status

- Proposed

## Context

We need managed hosting for the Next.js frontend and FastAPI backend that supports DORA-aligned practices: fast deploys, preview environments, rollbacks, and low operational overhead.

## Decision

| Component | Target | Rationale |
|---|---|---|
| Backend | Fly.io | Native Docker deploys, global Anycast, managed PostgreSQL option, simple CLI. |
| Frontend | Vercel | Optimized for Next.js, automatic previews on PRs, edge network. |
| Container registry | GitHub Container Registry | Free for public repos, integrates with GitHub Actions, no extra auth. |
| Image signing | Sigstore/Cosign | Free, SLSA-compatible, GitHub Actions native. |

## Consequences

### Positive

- Both platforms support Git push-to-deploy, enabling multiple deploys per day.
- Preview environments are automatic on Vercel and straightforward on Fly.io.
- Low cognitive load for the squad compared to AWS ECS/EKS.
- GHCR + Cosign provide supply-chain security without additional vendors.

### Negative

- Vendor lock-in to Fly.io and Vercel.
- Fly.io is smaller than AWS/GCP; enterprise procurement may prefer a hyperscaler.
- Multi-environment secrets management requires discipline.

## Environments

| Environment | Backend | Frontend | Purpose |
|---|---|---|---|
| Staging | `elite-backend-staging.fly.dev` | Vercel staging project | Pre-production validation |
| Production | `elite-backend.fly.dev` | Vercel production project | Live users |

## Rollback

- Backend: redeploy previous signed image via `flyctl deploy --image <previous-sha>`.
- Frontend: redeploy previous Vercel production build.

## Related

- `.github/workflows/deploy.yml`
- `.github/workflows/migrate.yml`
- `fly.toml`
- `vercel.json`
