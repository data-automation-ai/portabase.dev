variable "project_id" {
  type = string
}
variable "region" {
  type    = string
  default = "us-east1"
}
variable "zone" {
  type    = string
  default = "us-east1-b"
}
variable "instance_name" {
  type    = string
  default = "portabase-runner"
}
variable "machine_type" {
  type    = string
  default = "e2-micro"
}
variable "disk_size_gb" {
  type    = number
  default = 20
}
variable "secret_id" {
  type        = string
  description = "Existing Secret Manager secret ID containing the PortaBase environment JSON. Secret values never enter Terraform."
}
variable "package_url" {
  type        = string
  description = "HTTPS URL for the licensed PortaBase Linux package archive."
  validation {
    condition     = startswith(var.package_url, "https://")
    error_message = "package_url must use HTTPS."
  }
}
variable "package_sha256" {
  type        = string
  description = "Published SHA-256 for the exact package archive."
  validation {
    condition     = can(regex("^[A-Fa-f0-9]{64}$", var.package_sha256))
    error_message = "package_sha256 must be 64 hexadecimal characters."
  }
}
variable "supabase_project_ref" {
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9]{20}$", var.supabase_project_ref))
    error_message = "Supabase project ref must be 20 lowercase letters/digits."
  }
}
variable "rclone_remote" {
  type    = string
  default = "gcs"
}
variable "destination_path" {
  type    = string
  default = "/PortaBase"
}
variable "schedule_hours" {
  type    = number
  default = 6
  validation {
    condition     = var.schedule_hours >= 1 && var.schedule_hours <= 168
    error_message = "schedule_hours must be between 1 and 168."
  }
}
