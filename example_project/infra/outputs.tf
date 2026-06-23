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
