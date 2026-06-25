# subdomain-routing Terraform module

Reusable DNS and certificate layer for multi-tenant SaaS subdomain routing.

## Purpose

- Provisions a wildcard ACM certificate for `*.example.com`.
- Creates Route53 records that point wildcard and root traffic to Vercel.
- Documents the integration point with Vercel edge middleware / Edge Config.

## Foodcart SaaS relevance

Each business gets `slug.foodcartsite.com`. This module provisions the DNS and
TLS infrastructure. The actual slug→site resolution is implemented in Vercel
edge middleware (`src/frontend/middleware.ts`) and canary routing is controlled
by `scripts/update_edge_config_canary.py` during deployment.

## Usage

```hcl
provider "aws" {
  alias  = "us-east-1"
  region = "us-east-1"
}

module "routing" {
  source = "./pipeline/platform/terraform/modules/subdomain-routing"

  root_domain        = "foodcartsite.com"
  create_hosted_zone = false

  providers = {
    aws.us-east-1 = aws.us-east-1
  }
}
```

## Important notes

- The wildcard certificate is provisioned in `us-east-1`, which is required by
  CloudFront and recommended for Vercel custom domains.
- Edge middleware and Edge Config are **not** created by this module; they are
  application-level concerns owned by the squad.
- Custom domains (future) will reuse the same wildcard certificate pattern.
- This module is **document-only** for the current cycle; provision it when
  DNS cutover is scheduled.
