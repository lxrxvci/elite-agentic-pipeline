# ADR 0005: Production Runtime and Terraform Scope

## Status

Accepted

## Context

The Elite Agentic SDLC Pipeline can target multiple hosting models: Vercel serverless for the frontend and Python functions, container platforms (AWS ECS/Fargate, Fly.io, Kubernetes), or traditional VMs. We need a decision that lets teams go to production quickly while keeping the Terraform layer honest about what it actually provisions.

## Decision

We will use **Vercel as the production compute runtime** for both the Next.js frontend and the Python serverless backend. Terraform will manage only the **data and network layer** required for production:

- AWS VPC, public/private subnets, and NAT gateway.
- AWS RDS PostgreSQL instance.
- AWS Secrets Manager secret for the database password.
- S3 + DynamoDB remote state backend (provisioned via `infra/bootstrap/`).

All application runtime concerns (HTTP routing, TLS termination, edge caching, scaling, deploys) are delegated to Vercel. This is documented as an intentional trade-off, not an accidental gap.

## Consequences

- **Pros**: Fast deploys, global edge, no cluster/VM operational overhead, matches the scaffold's Vercel-only workflows.
- **Cons**: Less control over runtime; true traffic-splitting canary requires Vercel Edge Config or separate projects; compute is not defined in Terraform.

## Future options

If the product outgrows Vercel serverless, the next evaluation order is:

1. Vercel Edge Config + Middleware for traffic splitting.
2. Separate Vercel projects for canary/production.
3. Container runtime (ECS/Fargate or Kubernetes) with Terraform-managed ALB, ECR, and ECS service.

## Related

- `infra/main.tf`
- `infra/outputs.tf`
- `docs/adr/0004-canary-strategy.md`
- `.github/workflows/deploy.yml`
