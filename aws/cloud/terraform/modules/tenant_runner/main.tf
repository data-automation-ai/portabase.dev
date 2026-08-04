/**
 * Isolated managed runner for one Portabase Cloud workspace.
 * - Dedicated IAM task role scoped to this secret prefix
 * - Dedicated CloudWatch log group
 * - Optional Tailscale auth key secret + env
 */

variable "name_prefix" { type = string }
variable "workspace_id" { type = string }
variable "project_ref" { type = string }
variable "cluster_arn" { type = string }
variable "cluster_name" { type = string }
variable "subnet_ids" { type = list(string) }
variable "security_group_id" { type = string }
variable "execution_role_arn" { type = string }
variable "container_image" { type = string }
variable "kms_key_arn" { type = string }
variable "enable_tailscale" {
  type    = bool
  default = false
}
variable "log_retention_days" {
  type    = number
  default = 30
}
variable "metric_namespace" {
  type    = string
  default = "Portabase/Cloud"
}
variable "aws_region" { type = string }
variable "account_id" { type = string }
variable "cpu" {
  type    = string
  default = "1024"
}
variable "memory" {
  type    = string
  default = "2048"
}
variable "desired_count" {
  type    = number
  default = 1
}

locals {
  short_id      = substr(replace(var.workspace_id, "-", ""), 0, 12)
  secret_prefix = "portabase/tenants/${var.workspace_id}"
  family        = "${var.name_prefix}-runner-${local.short_id}"
  log_group     = "/portabase/tenants/${var.workspace_id}/runner"
}

resource "aws_cloudwatch_log_group" "runner" {
  name              = local.log_group
  retention_in_days = var.log_retention_days
  tags = {
    WorkspaceId = var.workspace_id
    ProjectRef  = var.project_ref
  }
}

resource "aws_secretsmanager_secret" "runner" {
  name       = "${local.secret_prefix}/runner"
  kms_key_id = var.kms_key_arn
  tags = {
    WorkspaceId = var.workspace_id
    Purpose     = "managed-runner-config"
  }
}

resource "aws_secretsmanager_secret" "tailscale" {
  count      = var.enable_tailscale ? 1 : 0
  name       = "${local.secret_prefix}/tailscale-auth-key"
  kms_key_id = var.kms_key_arn
  tags = {
    WorkspaceId = var.workspace_id
    Purpose     = "tailscale"
  }
}

resource "aws_iam_role" "task" {
  name = "${var.name_prefix}-task-${local.short_id}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = { WorkspaceId = var.workspace_id }
}

resource "aws_iam_role_policy" "task" {
  name = "tenant-isolation"
  role = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadOnlyOwnSecrets"
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = compact([
          "${aws_secretsmanager_secret.runner.arn}*",
          var.enable_tailscale ? "${aws_secretsmanager_secret.tailscale[0].arn}*" : null,
        ])
      },
      {
        Sid      = "DecryptOwnSecrets"
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = [var.kms_key_arn]
      },
      {
        Sid      = "EmitMetrics"
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricData"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "cloudwatch:namespace" = var.metric_namespace
          }
        }
      },
      {
        Sid    = "WriteOwnLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "${aws_cloudwatch_log_group.runner.arn}:*"
      }
    ]
  })
}

resource "aws_ecs_task_definition" "runner" {
  family                   = local.family
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode(concat(
    [
      {
        name      = "portabase"
        image     = var.container_image
        essential = true
        environment = [
          { name = "PORTABASE_WORKSPACE_ID", value = var.workspace_id },
          { name = "PORTABASE_PROJECT_REF", value = var.project_ref },
          { name = "PORTABASE_METRIC_NAMESPACE", value = var.metric_namespace },
          { name = "PORTABASE_MANAGED_RUNNER", value = "1" },
          { name = "AWS_REGION", value = var.aws_region },
        ]
        secrets = [
          {
            name      = "PORTABASE_RUNNER_SECRET"
            valueFrom = aws_secretsmanager_secret.runner.arn
          }
        ]
        logConfiguration = {
          logDriver = "awslogs"
          options = {
            awslogs-group         = aws_cloudwatch_log_group.runner.name
            awslogs-region        = var.aws_region
            awslogs-stream-prefix = "engine"
          }
        }
        healthCheck = {
          command     = ["CMD-SHELL", "node -e \"process.exit(0)\" || exit 0"]
          interval    = 60
          timeout     = 10
          retries     = 3
          startPeriod = 120
        }
      }
    ],
    var.enable_tailscale ? [
      {
        name      = "tailscale"
        image     = "tailscale/tailscale:stable"
        essential = false
        environment = [
          { name = "TS_USERSPACE", value = "true" },
          { name = "TS_HOSTNAME", value = "pb-${local.short_id}" },
          { name = "TS_EXTRA_ARGS", value = "--advertise-tags=tag:portabase-runner,tag:tenant-${local.short_id}" },
        ]
        secrets = [
          {
            name      = "TS_AUTHKEY"
            valueFrom = aws_secretsmanager_secret.tailscale[0].arn
          }
        ]
        logConfiguration = {
          logDriver = "awslogs"
          options = {
            awslogs-group         = aws_cloudwatch_log_group.runner.name
            awslogs-region        = var.aws_region
            awslogs-stream-prefix = "tailscale"
          }
        }
      }
    ] : []
  ))

  tags = {
    WorkspaceId = var.workspace_id
    ProjectRef  = var.project_ref
  }
}

resource "aws_ecs_service" "runner" {
  name            = local.family
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.runner.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [var.security_group_id]
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  tags = {
    WorkspaceId = var.workspace_id
  }

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}

resource "aws_cloudwatch_metric_alarm" "runner_cpu" {
  alarm_name          = "${local.family}-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 90
  dimensions = {
    ClusterName = var.cluster_name
    ServiceName = aws_ecs_service.runner.name
  }
  treat_missing_data = "notBreaching"
}

output "service_arn" {
  value = aws_ecs_service.runner.id
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.runner.arn
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "secret_prefix" {
  value = local.secret_prefix
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.runner.name
}

output "tailscale_hostname" {
  value = var.enable_tailscale ? "pb-${local.short_id}" : null
}
