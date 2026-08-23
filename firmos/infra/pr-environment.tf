# Ephemeral PR/preview environment resources.
# These are only created in non-default Terraform workspaces (e.g. a branch or
# PR workspace) and are destroyed when the workspace is deleted after the PR
# closes. This keeps preview infrastructure lightweight and isolated.

locals {
  preview_workspace = terraform.workspace != "default"
  preview_suffix    = local.preview_workspace ? "${var.project_name}-${terraform.workspace}" : ""
}

resource "aws_s3_bucket" "preview" {
  count = var.enable_pr_environments && local.preview_workspace ? 1 : 0

  #checkov:skip=CKV_AWS_18:Access logging is disabled for short-lived preview buckets.
  #checkov:skip=CKV_AWS_144:Cross-region replication is not required for preview buckets.
  #checkov:skip=CKV2_AWS_62:Event notifications are not required for preview buckets.
  #checkov:skip=CKV2_AWS_61:Object lifecycle is not required for short-lived preview buckets.
  #checkov:skip=CKV_AWS_145:AWS managed SSE-S3 encryption is acceptable for preview buckets.
  bucket = "${local.preview_suffix}-preview"
}

resource "aws_s3_bucket_versioning" "preview" {
  count = var.enable_pr_environments && local.preview_workspace ? 1 : 0

  bucket = aws_s3_bucket.preview[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "preview" {
  count = var.enable_pr_environments && local.preview_workspace ? 1 : 0

  bucket = aws_s3_bucket.preview[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "preview" {
  count = var.enable_pr_environments && local.preview_workspace ? 1 : 0

  bucket = aws_s3_bucket.preview[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "preview" {
  count = var.enable_pr_environments && local.preview_workspace ? 1 : 0

  name         = "${local.preview_suffix}-preview"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  #checkov:skip=CKV_AWS_119:AWS managed KMS key is acceptable for preview tables.
  attribute {
    name = "pk"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}
