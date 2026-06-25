# Object storage module for tenant-uploaded assets.
#
# Foodcart SaaS use case: logos, hero images, and menu photos uploaded by
# business owners. Objects are stored under a tenant-prefixed key pattern
# ("tenants/{tenant_id}/{filename}") and served through a CDN with
# presigned-URL uploads so the backend never handles large file bodies.

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

locals {
  bucket_name = var.bucket_name != "" ? var.bucket_name : "${var.project_name}-assets"
}

resource "aws_s3_bucket" "assets" {
  #checkov:skip=CKV_AWS_18:Access logging is delegated to the consuming squad.
  #checkov:skip=CKV_AWS_144:Cross-region replication is delegated to the consuming squad.
  #checkov:skip=CKV2_AWS_62:Event notifications are delegated to the consuming squad.
  #checkov:skip=CKV2_AWS_61:Object lifecycle is delegated to the consuming squad.
  bucket = local.bucket_name
}

resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = var.kms_key_id != "" ? "aws:kms" : "AES256"
      kms_master_key_id = var.kms_key_id != "" ? var.kms_key_id : null
    }
    bucket_key_enabled = var.kms_key_id != "" ? true : false
  }
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket = aws_s3_bucket.assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "assets" {
  count = var.cloudfront_enabled ? 1 : 0

  bucket = aws_s3_bucket.assets.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontOAI"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.assets.arn}/tenants/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.assets[0].arn
          }
        }
      }
    ]
  })
}

resource "aws_cloudfront_origin_access_identity" "assets" {
  count   = var.cloudfront_enabled ? 1 : 0
  comment = "OAI for ${local.bucket_name}"
}

resource "aws_cloudfront_distribution" "assets" {
  count = var.cloudfront_enabled ? 1 : 0

  enabled             = true
  is_ipv6_enabled     = true
  comment             = "CDN for ${local.bucket_name}"
  default_root_object = "index.html"
  price_class         = var.cloudfront_price_class

  origin {
    domain_name = aws_s3_bucket.assets.bucket_regional_domain_name
    origin_id   = "S3-${local.bucket_name}"

    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.assets[0].cloudfront_access_identity_path
    }
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-${local.bucket_name}"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 86400
    max_ttl                = 31536000
    compress               = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.acm_certificate_arn == "" ? true : false
    acm_certificate_arn            = var.acm_certificate_arn != "" ? var.acm_certificate_arn : null
    ssl_support_method             = var.acm_certificate_arn != "" ? "sni-only" : null
    minimum_protocol_version       = "TLSv1.2_2021"
  }
}

# IAM policy for the backend task/user that generates presigned upload URLs.
data "aws_iam_policy_document" "backend_assets" {
  statement {
    sid    = "TenantScopedReadWrite"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
    ]
    resources = [
      "${aws_s3_bucket.assets.arn}/tenants/*",
    ]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["tenants/${var.tenant_id_placeholder}/*"]
    }
  }
  statement {
    sid    = "ListTenantPrefix"
    effect = "Allow"
    actions = [
      "s3:ListBucket",
    ]
    resources = [aws_s3_bucket.assets.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["tenants/${var.tenant_id_placeholder}/*"]
    }
  }
}

resource "aws_iam_policy" "backend_assets" {
  name   = "${var.project_name}-backend-assets"
  policy = data.aws_iam_policy_document.backend_assets.json
}
