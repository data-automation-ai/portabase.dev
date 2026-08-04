resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-runners"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = { Name = "${local.name_prefix}-ecs" }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]
  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/portabase/cloud/${var.environment}/api"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "runners_root" {
  name              = "/portabase/cloud/${var.environment}/runners"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "ecs_execution" {
  name = "${local.name_prefix}-ecs-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "${local.name_prefix}-execution-secrets"
  role = aws_iam_role.ecs_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "kms:Decrypt",
        ]
        Resource = [
          aws_kms_key.secrets.arn,
          "arn:aws:secretsmanager:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:secret:portabase/*",
          "${aws_secretsmanager_secret.supabase_service.arn}*",
        ]
      }
    ]
  })
}

# Example tenant runner (optional — use API for production provisioning)
module "example_tenant_runner" {
  count  = var.enable_example_tenant_runner && var.runner_image != "" ? 1 : 0
  source = "./modules/tenant_runner"

  name_prefix       = local.name_prefix
  workspace_id      = var.example_workspace_id
  project_ref       = "exampleprojectref0001"
  cluster_arn       = aws_ecs_cluster.main.arn
  cluster_name      = aws_ecs_cluster.main.name
  subnet_ids        = aws_subnet.private[*].id
  security_group_id = aws_security_group.runner.id
  execution_role_arn = aws_iam_role.ecs_execution.arn
  container_image   = var.runner_image
  kms_key_arn       = aws_kms_key.secrets.arn
  enable_tailscale  = var.example_enable_tailscale
  log_retention_days = var.log_retention_days
  metric_namespace  = local.metric_namespace
  aws_region        = var.aws_region
  account_id        = data.aws_caller_identity.current.account_id
}
