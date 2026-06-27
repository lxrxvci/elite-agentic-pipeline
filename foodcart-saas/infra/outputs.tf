output "vpc_id" {
  description = "ID of the VPC provisioned for the application"
  value       = module.vpc.vpc_id
}

output "private_subnet_ids" {
  description = "Private subnet IDs for database and internal resources"
  value       = module.vpc.private_subnets
}

output "public_subnet_ids" {
  description = "Public subnet IDs for externally-facing resources"
  value       = module.vpc.public_subnets
}

output "database_endpoint" {
  description = "RDS PostgreSQL endpoint"
  value       = aws_db_instance.main.endpoint
}

output "database_url" {
  description = "PostgreSQL connection string for the application"
  value       = "postgresql+psycopg://${var.db_username}:${var.db_password}@${aws_db_instance.main.endpoint}/${var.project_name}"
  sensitive   = true
}

output "db_password_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the database password"
  value       = aws_secretsmanager_secret.db_password.arn
}

output "redis_endpoint" {
  description = "ElastiCache Redis primary endpoint"
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "redis_url" {
  description = "Redis connection URL for the application"
  value       = "redis://${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379/0"
  sensitive   = true
}

output "github_actions_role_arn" {
  description = "ARN of the IAM role that GitHub Actions assumes via OIDC"
  value       = aws_iam_role.github_actions.arn
}

output "storage_bucket_name" {
  description = "Name of the S3 bucket for uploaded images"
  value       = var.enable_storage ? aws_s3_bucket.foodcart_uploads[0].id : null
}

output "storage_bucket_arn" {
  description = "ARN of the S3 bucket for uploaded images"
  value       = var.enable_storage ? aws_s3_bucket.foodcart_uploads[0].arn : null
}

output "storage_iam_policy_arn" {
  description = "ARN of the IAM policy granting access to the uploads bucket"
  value       = var.enable_storage ? aws_iam_policy.foodcart_uploads[0].arn : null
}

output "preview_bucket" {
  description = "Name of the ephemeral S3 bucket created for the current preview workspace"
  value       = var.enable_pr_environments && terraform.workspace != "default" ? aws_s3_bucket.preview[0].id : null
}

output "preview_table" {
  description = "Name of the ephemeral DynamoDB table created for the current preview workspace"
  value       = var.enable_pr_environments && terraform.workspace != "default" ? aws_dynamodb_table.preview[0].id : null
}
