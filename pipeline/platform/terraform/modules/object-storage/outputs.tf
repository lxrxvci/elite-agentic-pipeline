output "bucket_name" {
  description = "Name of the S3 bucket for tenant assets"
  value       = aws_s3_bucket.assets.id
}

output "bucket_arn" {
  description = "ARN of the S3 bucket for tenant assets"
  value       = aws_s3_bucket.assets.arn
}

output "cdn_domain" {
  description = "CloudFront distribution domain name"
  value       = var.cloudfront_enabled ? aws_cloudfront_distribution.assets[0].domain_name : null
}

output "cdn_distribution_id" {
  description = "CloudFront distribution ID"
  value       = var.cloudfront_enabled ? aws_cloudfront_distribution.assets[0].id : null
}

output "backend_assets_policy_arn" {
  description = "ARN of the IAM policy granting tenant-scoped S3 access"
  value       = aws_iam_policy.backend_assets.arn
}

output "tenant_key_pattern" {
  description = "Documented key pattern for tenant-scoped uploads"
  value       = "tenants/{tenant_id}/{filename}"
}
