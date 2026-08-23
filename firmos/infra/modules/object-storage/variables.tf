variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
}

variable "bucket_name" {
  description = "Override the generated S3 bucket name"
  type        = string
  default     = ""
}

variable "cloudfront_enabled" {
  description = "Whether to create a CloudFront distribution in front of the bucket"
  type        = bool
  default     = true
}

variable "cloudfront_price_class" {
  description = "CloudFront price class"
  type        = string
  default     = "PriceClass_100"
}

variable "acm_certificate_arn" {
  description = "ARN of an ACM certificate in us-east-1 for the CloudFront distribution"
  type        = string
  default     = ""
}

variable "kms_key_id" {
  description = "KMS key ID for bucket encryption. If empty, AES256 (SSE-S3) is used."
  type        = string
  default     = ""
}

variable "tenant_id_placeholder" {
  description = "Placeholder used in IAM policy examples to document tenant scoping"
  type        = string
  default     = "{tenant_id}"
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
