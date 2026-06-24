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
  region = var.aws_region
}

resource "aws_s3_bucket" "terraform_state" {
  #checkov:skip=CKV_AWS_18:Access logging is intentionally disabled for the state bucket in this reference architecture.
  #checkov:skip=CKV_AWS_144:Cross-region replication is not required for the Terraform state bucket.
  #checkov:skip=CKV2_AWS_62:Event notifications are not required for the Terraform state bucket.
  #checkov:skip=CKV2_AWS_61:Object lifecycle is not required for the Terraform state bucket.
  #checkov:skip=CKV_AWS_145:AWS managed SSE-S3 encryption is acceptable for the state bucket.
  bucket = var.state_bucket_name
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "terraform_locks" {
  name         = var.lock_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  #checkov:skip=CKV_AWS_119:AWS managed KMS key is acceptable for the lock table.
  attribute {
    name = "LockID"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}
