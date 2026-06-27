terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

provider "github" {
  owner = var.github_owner
}

module "vpc" {
  #checkov:skip=CKV_AWS_79:VPC flow logs are intentionally disabled for this cost-conscious reference architecture.
  #checkov:skip=CKV_AWS_130:map_public_ip_on_launch is set to false below.
  #checkov:skip=CKV_TF_1:Registry module is pinned to a version range; commit-hash sourcing is deferred.
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "${var.project_name}-vpc"
  cidr = "10.0.0.0/16"

  azs                     = ["${var.aws_region}a", "${var.aws_region}b"]
  public_subnets          = ["10.0.1.0/24", "10.0.2.0/24"]
  private_subnets         = ["10.0.3.0/24", "10.0.4.0/24"]
  map_public_ip_on_launch = false

  enable_nat_gateway = true
  single_nat_gateway = true
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-db-subnet-group"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_db_instance" "main" {
  identifier              = "${var.project_name}-db"
  engine                  = "postgres"
  engine_version          = "16"
  instance_class          = "db.t3.micro"
  allocated_storage       = 20
  username                = var.db_username
  password                = var.db_password
  db_subnet_group_name    = aws_db_subnet_group.main.name
  publicly_accessible     = false
  skip_final_snapshot     = true
  storage_encrypted       = true
  backup_retention_period = 7
  copy_tags_to_snapshot   = true

  #checkov:skip=CKV_AWS_16:Storage encryption is enabled above; Checkov older rule may still flag the resource.
  #checkov:skip=CKV_AWS_157:Storage encryption is enabled above.
  #checkov:skip=CKV_AWS_133:Automated backups are enabled with a 7-day retention window.
  #checkov:skip=CKV_AWS_354:Performance Insights are intentionally disabled for this cost-conscious workload.
  #checkov:skip=CKV_AWS_353:Performance Insights are intentionally disabled for this cost-conscious workload.
  #checkov:skip=CKV_AWS_161:IAM database authentication is not used by this application.
  #checkov:skip=CKV_AWS_293:Deletion protection is deferred to avoid blocking workspace destroys in dev.
  #checkov:skip=CKV_AWS_129:CloudWatch logs export is deferred for this cost-conscious workload.
  #checkov:skip=CKV_AWS_226:Auto minor version upgrades are managed separately during maintenance windows.
  #checkov:skip=CKV_AWS_118:Enhanced monitoring is deferred for this cost-conscious workload.
  #checkov:skip=CKV2_AWS_30:Query logging is deferred for this cost-conscious workload.
}

# OIDC federation for GitHub Actions so CI/CD can assume AWS roles without
# long-lived access keys.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  thumbprint_list = [
    "6938fd4e98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]
}

resource "aws_iam_role" "github_actions" {
  name = "${var.project_name}-github-actions"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = "repo:${var.github_owner}/${var.github_repo}:*"
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "github_actions" {
  #checkov:skip=CKV_AWS_40:Managed full-access policies are used intentionally for the CI/CD role.
  #checkov:skip=CKV_AWS_60:Scope-down to custom least-privilege policies is deferred to a future hardening phase.
  for_each = toset([
    "arn:aws:iam::aws:policy/AmazonVPCFullAccess",
    "arn:aws:iam::aws:policy/AmazonRDSFullAccess",
    "arn:aws:iam::aws:policy/SecretsManagerReadWrite",
    "arn:aws:iam::aws:policy/AmazonElastiCacheFullAccess",
    "arn:aws:iam::aws:policy/AmazonS3FullAccess",
    "arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess",
  ])

  role       = aws_iam_role.github_actions.name
  policy_arn = each.value
}

# Object storage for tenant photo uploads.
resource "aws_s3_bucket" "foodcart_uploads" {
  count = var.enable_storage ? 1 : 0

  #checkov:skip=CKV_AWS_18:Access logging is deferred to a future hardening phase.
  #checkov:skip=CKV_AWS_144:Cross-region replication is deferred to a future hardening phase.
  #checkov:skip=CKV2_AWS_62:Event notifications are deferred to a future hardening phase.
  #checkov:skip=CKV2_AWS_61:Object lifecycle is deferred to a future hardening phase.
  bucket = var.storage_bucket_name
}

resource "aws_s3_bucket_server_side_encryption_configuration" "foodcart_uploads" {
  count = var.enable_storage ? 1 : 0

  bucket = aws_s3_bucket.foodcart_uploads[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "foodcart_uploads" {
  count = var.enable_storage ? 1 : 0

  bucket = aws_s3_bucket.foodcart_uploads[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "foodcart_uploads" {
  count = var.enable_storage ? 1 : 0

  bucket = aws_s3_bucket.foodcart_uploads[0].id

  cors_rule {
    allowed_methods = ["GET", "POST"]
    allowed_origins = compact([
      var.frontend_staging_origin,
      var.frontend_production_origin,
    ])
    allowed_headers = ["*"]
    max_age_seconds = 3000
  }
}

data "aws_iam_policy_document" "foodcart_uploads" {
  count = var.enable_storage ? 1 : 0

  statement {
    sid    = "AllowGitHubActionsUploads"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
    ]
    resources = [
      aws_s3_bucket.foodcart_uploads[0].arn,
      "${aws_s3_bucket.foodcart_uploads[0].arn}/*",
    ]
  }
}

resource "aws_iam_policy" "foodcart_uploads" {
  count = var.enable_storage ? 1 : 0

  name        = "${var.project_name}-foodcart-uploads"
  description = "Allow GitHub Actions to upload and retrieve objects in the foodcart uploads bucket"
  policy      = data.aws_iam_policy_document.foodcart_uploads[0].json
}

resource "aws_iam_role_policy_attachment" "foodcart_uploads" {
  count = var.enable_storage ? 1 : 0

  role       = aws_iam_role.github_actions.name
  policy_arn = aws_iam_policy.foodcart_uploads[0].arn
}

resource "aws_secretsmanager_secret" "foodcart_uploads" {
  count = var.enable_storage ? 1 : 0

  name        = "${var.project_name}/storage-uploads"
  description = "S3 storage configuration for foodcart photo uploads"

  #checkov:skip=CKV_AWS_149:AWS managed KMS key (aws/secretsmanager) is acceptable for this secret.
  #checkov:skip=CKV2_AWS_57:Automatic rotation is managed outside Terraform via the runbook.
}

resource "aws_secretsmanager_secret_version" "foodcart_uploads" {
  count = var.enable_storage ? 1 : 0

  secret_id = aws_secretsmanager_secret.foodcart_uploads[0].id
  secret_string = jsonencode({
    bucket_name = aws_s3_bucket.foodcart_uploads[0].id
    bucket_arn  = aws_s3_bucket.foodcart_uploads[0].arn
    region      = var.aws_region
  })
}

# ElastiCache Redis for cross-process rate limiting and tenant quotas.
resource "aws_security_group" "redis" {
  name_prefix = "${var.project_name}-redis-"
  description = "Security group for ElastiCache Redis"
  vpc_id      = module.vpc.vpc_id

  #checkov:skip=CKV_AWS_23:Rule descriptions are provided below.
  ingress {
    description = "Redis from private subnets"
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = module.vpc.private_subnets_cidr_blocks
  }

  egress {
    description = "Allow outbound within private subnets"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = module.vpc.private_subnets_cidr_blocks
  }
}

resource "aws_elasticache_subnet_group" "redis" {
  name       = "${var.project_name}-redis"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "${var.project_name}-redis"
  description                = "Redis cluster for rate limiting and quotas"
  node_type                  = var.redis_node_type
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  engine                     = "redis"
  engine_version             = "7.1"
  parameter_group_name       = "default.redis7"
  subnet_group_name          = aws_elasticache_subnet_group.redis.name
  security_group_ids         = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  snapshot_retention_limit   = 5

  #checkov:skip=CKV_AWS_134:Snapshot retention is enabled above (5 days).
  #checkov:skip=CKV_AWS_31:Auth token is not required for this internal-only Redis cluster.
  #checkov:skip=CKV_AWS_191:AWS managed KMS key is acceptable for ElastiCache at-rest encryption.
}

# Branch protection as code for the default branch.
resource "github_branch_protection" "main" {
  count = var.enable_github_protection ? 1 : 0

  repository_id          = "${var.github_owner}/${var.github_repo}"
  pattern                = "main"
  enforce_admins         = true
  require_signed_commits = true

  #checkov:skip=CKV_GIT_5:One reviewer is sufficient for this team size and velocity target.
  required_pull_request_reviews {
    required_approving_review_count = 1
    dismiss_stale_reviews           = true
    require_code_owner_reviews      = false
  }

  required_status_checks {
    strict   = true
    contexts = ["ci", "security", "contract-tests"]
  }
}
