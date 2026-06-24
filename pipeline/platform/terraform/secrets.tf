resource "aws_secretsmanager_secret" "db_password" {
  name        = "${var.project_name}/db-password"
  description = "Database password for the Elite application"

  #checkov:skip=CKV_AWS_149:AWS managed KMS key (aws/secretsmanager) is acceptable for this secret.
  #checkov:skip=CKV2_AWS_57:Automatic rotation is managed outside Terraform via the runbook.
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = var.db_password
}

