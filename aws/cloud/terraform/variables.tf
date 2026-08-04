variable "project_name" {
  type        = string
  description = "Name prefix for Portabase Cloud resources."
  default     = "portabase-cloud"
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "availability_zones" {
  type        = list(string)
  description = "At least two AZs for private runners."
  default     = ["us-east-1a", "us-east-1b"]
}

variable "cognito_domain_prefix" {
  type        = string
  description = "Unique Cognito hosted UI domain prefix."
}

variable "console_callback_urls" {
  type        = list(string)
  description = "SPA callback URLs for Cognito."
  default = [
    "http://localhost:5173/auth/callback",
    "https://portabase.dev/auth/callback",
    "https://www.portabase.dev/auth/callback",
    "https://cloud.portabase.dev/auth/callback",
  ]
}

variable "console_logout_urls" {
  type        = list(string)
  default = [
    "http://localhost:5173/",
    "https://portabase.dev/",
    "https://www.portabase.dev/",
    "https://cloud.portabase.dev/",
  ]
}

variable "google_oauth_client_id" {
  type        = string
  description = "Google OAuth 2.0 Web client ID for Cognito federation. Empty disables Google IdP."
  default     = ""
}

variable "google_oauth_client_secret" {
  type        = string
  description = "Google OAuth 2.0 Web client secret."
  default     = ""
  sensitive   = true
}

variable "supabase_url" {
  type        = string
  description = "Hosted Supabase control-plane URL (https://xxx.supabase.co)."
  sensitive   = true
}

variable "supabase_service_role_secret_arn" {
  type        = string
  description = "Secrets Manager ARN holding SUPABASE_SERVICE_ROLE_KEY for API Lambdas."
  default     = ""
}

variable "runner_image" {
  type        = string
  description = "ECR image URI for managed Portabase runners (tag or digest)."
  default     = ""
}

variable "enable_nat_gateway" {
  type        = bool
  default     = true
  description = "Private subnet egress for runners (required for managed runners)."
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "alarm_email" {
  type        = string
  description = "Optional email subscription on the default SNS alarm topic."
  default     = ""
}

variable "enable_example_tenant_runner" {
  type        = bool
  default     = false
  description = "If true, provisions one example tenant runner module (dev only)."
}

variable "example_workspace_id" {
  type        = string
  default     = "00000000-0000-0000-0000-000000000001"
  description = "Workspace UUID for the optional example runner."
}

variable "example_enable_tailscale" {
  type    = bool
  default = false
}
