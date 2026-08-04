/**
 * EBS volume image / snapshot policy
 *
 * RULE: When selecting an EBS snapshot or AMI built from EBS for restore,
 * launch, or image rebuild — always use the MOST RECENT completed backup.
 * Never pin a stale snapshot/AMI id unless an operator sets an explicit override.
 *
 * - Data Lifecycle Manager creates tagged snapshots on a schedule
 * - data.aws_ebs_snapshot.latest uses most_recent = true (when lookup enabled)
 * - data.aws_ami.latest_portabase uses most_recent = true for Portabase AMIs
 */

variable "ebs_backup_enabled" {
  type        = bool
  default     = true
  description = "Create DLM lifecycle policy for EBS volume snapshots."
}

variable "ebs_backup_target_tags" {
  type        = map(string)
  default     = { PortabaseBackup = "true" }
  description = "Only volumes with these tags are snapshotted by DLM."
}

variable "ebs_snapshot_retention_count" {
  type        = number
  default     = 14
  description = "How many completed snapshots DLM keeps per volume (newest retained)."
}

variable "ebs_snapshot_interval_hours" {
  type        = number
  default     = 24
  description = "DLM snapshot interval in hours."
}

variable "ebs_lookup_latest_snapshot" {
  type        = bool
  default     = false
  description = "If true, resolve data.aws_ebs_snapshot.latest (requires at least one matching completed snapshot)."
}

variable "ebs_lookup_filter_tags" {
  type        = map(string)
  default     = { PortabaseBackup = "true" }
  description = "Tag filters for most-recent snapshot/AMI lookup."
}

variable "ebs_snapshot_override_id" {
  type        = string
  default     = ""
  description = "Optional hard pin. Leave empty to always take most recent. Only set for forensic rollback."
}

variable "ebs_ami_name_prefix" {
  type        = string
  default     = "portabase-"
  description = "AMI name prefix for most_recent AMI lookup."
}

variable "ebs_lookup_latest_ami" {
  type        = bool
  default     = false
  description = "If true, resolve data.aws_ami.latest_portabase with most_recent = true."
}

# ---------------------------------------------------------------------------
# DLM — keep rolling newest snapshots
# ---------------------------------------------------------------------------
resource "aws_iam_role" "dlm" {
  count = var.ebs_backup_enabled ? 1 : 0
  name  = "${local.name_prefix}-dlm"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "dlm.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "dlm" {
  count      = var.ebs_backup_enabled ? 1 : 0
  role       = aws_iam_role.dlm[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

resource "aws_dlm_lifecycle_policy" "ebs_volumes" {
  count              = var.ebs_backup_enabled ? 1 : 0
  description        = "Portabase EBS snapshots"
  execution_role_arn = aws_iam_role.dlm[0].arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]

    target_tags = var.ebs_backup_target_tags

    schedule {
      name = "portabase-rolling-newest"

      create_rule {
        interval      = var.ebs_snapshot_interval_hours
        interval_unit = "HOURS"
        times         = ["03:00"]
      }

      retain_rule {
        count = var.ebs_snapshot_retention_count
      }

      tags_to_add = merge(
        {
          PortabaseBackup = "true"
          PortabasePolicy = "most-recent-only"
          ManagedBy       = "dlm"
        },
        { Environment = var.environment }
      )

      copy_tags = true
    }
  }

  tags = {
    Name              = "${local.name_prefix}-ebs-dlm"
    PortabasePolicy   = "most-recent-only"
  }
}

# ---------------------------------------------------------------------------
# Lookups — always most_recent unless override id is set
# ---------------------------------------------------------------------------
data "aws_ebs_snapshot" "latest" {
  count = var.ebs_lookup_latest_snapshot && var.ebs_snapshot_override_id == "" ? 1 : 0

  most_recent = true
  owners      = ["self"]

  filter {
    name   = "status"
    values = ["completed"]
  }

  dynamic "filter" {
    for_each = var.ebs_lookup_filter_tags
    content {
      name   = "tag:${filter.key}"
      values = [filter.value]
    }
  }
}

data "aws_ami" "latest_portabase" {
  count = var.ebs_lookup_latest_ami ? 1 : 0

  most_recent = true
  owners      = ["self"]

  filter {
    name   = "name"
    values = ["${var.ebs_ami_name_prefix}*"]
  }

  filter {
    name   = "state"
    values = ["available"]
  }

  filter {
    name   = "root-device-type"
    values = ["ebs"]
  }

  dynamic "filter" {
    for_each = var.ebs_lookup_filter_tags
    content {
      name   = "tag:${filter.key}"
      values = [filter.value]
    }
  }
}

locals {
  # Policy: most recent completed backup, unless operator sets forensic override.
  ebs_selected_snapshot_id = (
    var.ebs_snapshot_override_id != "" ? var.ebs_snapshot_override_id :
    try(data.aws_ebs_snapshot.latest[0].id, null)
  )
  ebs_selected_snapshot_start_time = try(data.aws_ebs_snapshot.latest[0].start_time, null)
  ebs_selected_ami_id              = try(data.aws_ami.latest_portabase[0].id, null)
  ebs_using_override               = var.ebs_snapshot_override_id != ""
}

output "ebs_dlm_policy_id" {
  value       = try(aws_dlm_lifecycle_policy.ebs_volumes[0].id, null)
  description = "DLM policy that rolls newest EBS snapshots."
}

output "ebs_selected_snapshot_id" {
  value       = local.ebs_selected_snapshot_id
  description = "Resolved snapshot: override if set, else most recent completed PortabaseBackup snapshot."
}

output "ebs_selected_snapshot_start_time" {
  value       = local.ebs_selected_snapshot_start_time
  description = "Start time of the selected snapshot (proves newest when not overridden)."
}

output "ebs_using_snapshot_override" {
  value       = local.ebs_using_override
  description = "True only when ebs_snapshot_override_id is set (forensic pin)."
}

output "ebs_selected_ami_id" {
  value       = local.ebs_selected_ami_id
  description = "Most recent available EBS-backed Portabase AMI (when lookup enabled)."
}

output "ebs_backup_policy" {
  value = {
    rule              = "always_use_most_recent_completed_backup"
    override_allowed  = "set ebs_snapshot_override_id only for forensic rollback"
    dlm_enabled       = var.ebs_backup_enabled
    retention_count   = var.ebs_snapshot_retention_count
    interval_hours    = var.ebs_snapshot_interval_hours
    volume_target_tags = var.ebs_backup_target_tags
  }
}
