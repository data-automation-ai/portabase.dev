output "vpc_id" {
  value = aws_vpc.main.id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "ecs_cluster_arn" {
  value = aws_ecs_cluster.main.arn
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "cognito_user_pool_client_id" {
  value = aws_cognito_user_pool_client.console.id
}

output "cognito_user_pool_endpoint" {
  value = aws_cognito_user_pool.main.endpoint
}

output "cognito_domain" {
  value = aws_cognito_user_pool_domain.main.domain
}

output "api_endpoint" {
  value = aws_apigatewayv2_api.cloud.api_endpoint
}

output "telemetry_ingest_path" {
  value = "${aws_apigatewayv2_api.cloud.api_endpoint}/v1/telemetry"
}

output "cloudwatch_namespace" {
  value = local.metric_namespace
}

output "sns_alarm_topic_arn" {
  value = aws_sns_topic.alarms.arn
}

output "runner_execution_role_arn" {
  value = aws_iam_role.ecs_execution.arn
}

output "secrets_kms_key_arn" {
  value = aws_kms_key.secrets.arn
}

output "tenant_secret_path_pattern" {
  value = "portabase/tenants/{workspace_id}/"
}
