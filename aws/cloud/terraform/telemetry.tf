resource "aws_sns_topic" "alarms" {
  name              = "${local.name_prefix}-alarms"
  kms_master_key_id = aws_kms_key.secrets.id
  tags              = { Name = "${local.name_prefix}-alarms" }
}

resource "aws_sns_topic_subscription" "alarm_email" {
  count     = var.alarm_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# Custom metrics expected from ingest Lambda / agents (EMF or PutMetricData):
# Portabase/Cloud BackupFailure, HeartbeatMissing, RunnerTaskFailed
resource "aws_cloudwatch_dashboard" "ops" {
  dashboard_name = "${local.name_prefix}-ops"
  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "Backup outcomes"
          region  = var.aws_region
          metrics = [
            [local.metric_namespace, "BackupSuccess", { stat = "Sum", period = 300 }],
            [".", "BackupFailure", { stat = "Sum", period = 300 }],
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "Agent heartbeats"
          region  = var.aws_region
          metrics = [
            [local.metric_namespace, "HeartbeatAgeHours", { stat = "Maximum", period = 300 }],
          ]
        }
      }
    ]
  })
}
