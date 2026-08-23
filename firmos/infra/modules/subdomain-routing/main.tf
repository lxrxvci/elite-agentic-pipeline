# Subdomain routing module for multi-tenant SaaS.
#
# Foodcart SaaS use case: each business gets a branded URL such as
# slug.foodcartsite.com. This module provisions the DNS and certificate layers.
# The actual request routing is handled by Vercel edge middleware, which reads
# the Host header and resolves the published site for the slug.

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  alias  = "us-east-1"
  region = "us-east-1"
}

resource "aws_route53_zone" "primary" {
  count = var.create_hosted_zone ? 1 : 0
  name  = var.root_domain
}

data "aws_route53_zone" "primary" {
  count        = var.create_hosted_zone ? 0 : 1
  name         = var.root_domain
  private_zone = false
}

locals {
  zone_id = var.create_hosted_zone ? aws_route53_zone.primary[0].zone_id : data.aws_route53_zone.primary[0].zone_id
}

# Wildcard certificate for the root domain and all tenant subdomains.
resource "aws_acm_certificate" "wildcard" {
  provider          = aws.us-east-1
  domain_name       = var.root_domain
  validation_method = "DNS"
  subject_alternative_names = [
    "*.${var.root_domain}",
  ]

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "wildcard_validation" {
  for_each = {
    for dvo in aws_acm_certificate.wildcard.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id = local.zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "wildcard" {
  provider                = aws.us-east-1
  certificate_arn         = aws_acm_certificate.wildcard.arn
  validation_record_fqdns = [for record in aws_route53_record.wildcard_validation : record.fqdn]
}

# Wildcard A + AAAA aliases pointing at Vercel.
# Vercel owns the IPs 76.76.21.21 (A) and the alias cname.vercel-dns.com.
# For apex + wildcard we use A records; delegating the whole zone to Vercel
# keeps edge routing logic in code rather than in Terraform.
resource "aws_route53_record" "wildcard_a" {
  zone_id = local.zone_id
  name    = "*.${var.root_domain}"
  type    = "A"
  ttl     = 300
  records = var.vercel_a_records
}

resource "aws_route53_record" "wildcard_aaaa" {
  zone_id = local.zone_id
  name    = "*.${var.root_domain}"
  type    = "AAAA"
  ttl     = 300
  records = var.vercel_aaaa_records
}

resource "aws_route53_record" "root_a" {
  zone_id = local.zone_id
  name    = var.root_domain
  type    = "A"
  ttl     = 300
  records = var.vercel_a_records
}

resource "aws_route53_record" "root_aaaa" {
  zone_id = local.zone_id
  name    = var.root_domain
  type    = "AAAA"
  ttl     = 300
  records = var.vercel_aaaa_records
}
