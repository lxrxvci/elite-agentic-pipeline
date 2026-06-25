output "hosted_zone_id" {
  description = "Route53 hosted zone ID for the root domain"
  value       = local.zone_id
}

output "wildcard_certificate_arn" {
  description = "ARN of the ACM wildcard certificate (provisioned in us-east-1 for Vercel/CloudFront)"
  value       = aws_acm_certificate.wildcard.arn
}

output "root_domain" {
  description = "Root domain for tenant subdomains"
  value       = var.root_domain
}

output "tenant_domain_pattern" {
  description = "Documented tenant subdomain pattern"
  value       = "{slug}.${var.root_domain}"
}

output "vercel_edge_config_note" {
  description = "Note about edge routing configuration"
  value       = "Vercel edge middleware must read the Host header and resolve slug to a published site. Edge Config is managed by the deploy workflow, not this module."
}
