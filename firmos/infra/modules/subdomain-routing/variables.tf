variable "root_domain" {
  description = "Root domain for the multi-tenant SaaS (e.g. foodcartsite.com)"
  type        = string
}

variable "create_hosted_zone" {
  description = "Create a new Route53 hosted zone. Set to false to use an existing zone."
  type        = bool
  default     = false
}

variable "vercel_a_records" {
  description = "Vercel A records for wildcard/root routing"
  type        = list(string)
  default     = ["76.76.21.21"]
}

variable "vercel_aaaa_records" {
  description = "Vercel AAAA records for wildcard/root routing"
  type        = list(string)
  default = [
    "2600:1f18:2489:8200::c8",
    "2600:1f18:2489:8201::c8",
    "2600:1f18:2489:8202::c8",
    "2600:1f18:2489:8203::c8",
  ]
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
