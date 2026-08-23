# object-storage Terraform module

Reusable object-storage stack for tenant-uploaded assets (logos, hero images,
menu photos, etc.).

## Purpose

- Creates an encrypted, versioned, private S3 bucket.
- Optionally fronts it with a CloudFront CDN.
- Provides an IAM policy that grants tenant-scoped read/write access so the
  backend can generate presigned upload URLs without handling file bodies.

## Foodcart SaaS relevance

Business owners upload logos and hero images during onboarding. Objects are
stored under `tenants/{tenant_id}/{filename}`. The backend validates the
authenticated user's `tenant_id` before generating a presigned URL, enforcing
that a tenant can never read or overwrite another tenant's assets.

## Usage

```hcl
module "assets" {
  source = "./pipeline/platform/terraform/modules/object-storage"

  project_name         = "foodcart"
  cloudfront_enabled   = true
  acm_certificate_arn  = module.subdomain_routing.cdn_certificate_arn
  kms_key_id           = aws_kms_key.assets.arn

  tags = {
    Squad = "foodcart"
  }
}
```

## Important notes

- The bucket is private by default. Public access is blocked.
- CloudFront requires an ACM certificate in `us-east-1`.
- The generated IAM policy uses a placeholder for tenant scoping. Attach it to
  the backend task role and enforce the actual `tenant_id` in application code.
- This module is **document-only** for the current cycle; provision it when
  image upload moves from prototype to production.
