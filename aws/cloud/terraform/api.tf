# HTTP API for console + telemetry. Handlers are stubs wired for Cognito JWT.
# Replace Lambda zip with real control-plane implementation when ready.

data "archive_file" "api_stub" {
  type        = "zip"
  output_path = "${path.module}/.build/api_stub.zip"
  source {
    content  = file("${path.module}/lambda/api_stub/index.mjs")
    filename = "index.mjs"
  }
}

resource "aws_iam_role" "api_lambda" {
  name = "${local.name_prefix}-api-lambda"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "api_lambda_basic" {
  role       = aws_iam_role.api_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "api_lambda_extra" {
  name = "${local.name_prefix}-api-extra"
  role = aws_iam_role.api_lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "cloudwatch:PutMetricData",
          "sns:Publish",
          "ecs:RunTask",
          "ecs:DescribeTasks",
          "ecs:DescribeServices",
          "ecs:UpdateService",
          "iam:PassRole",
        ]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = [aws_kms_key.secrets.arn]
      }
    ]
  })
}

resource "aws_lambda_function" "api" {
  function_name = "${local.name_prefix}-api"
  role          = aws_iam_role.api_lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  filename      = data.archive_file.api_stub.output_path
  source_code_hash = data.archive_file.api_stub.output_base64sha256
  timeout       = 30
  memory_size   = 256

  environment {
    variables = {
      COGNITO_USER_POOL_ID = aws_cognito_user_pool.main.id
      COGNITO_CLIENT_ID    = aws_cognito_user_pool_client.console.id
      COGNITO_REGION       = var.aws_region
      SUPABASE_URL         = var.supabase_url
      SUPABASE_SECRET_ARN  = coalesce(var.supabase_service_role_secret_arn, aws_secretsmanager_secret.supabase_service.arn)
      METRIC_NAMESPACE     = local.metric_namespace
      SNS_ALARM_TOPIC_ARN  = aws_sns_topic.alarms.arn
      ECS_CLUSTER_ARN      = aws_ecs_cluster.main.arn
      ENVIRONMENT          = var.environment
    }
  }

  depends_on = [aws_cloudwatch_log_group.api]
}

resource "aws_apigatewayv2_api" "cloud" {
  name          = "${local.name_prefix}-http"
  protocol_type = "HTTP"
  cors_configuration {
    allow_headers = ["authorization", "content-type", "x-portabase-agent"]
    allow_methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    allow_origins = ["https://cloud.portabase.dev", "http://localhost:5173"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.cloud.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "cognito"
  jwt_configuration {
    audience = [aws_cognito_user_pool_client.console.id]
    issuer   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.cloud.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "health" {
  api_id    = aws_apigatewayv2_api.cloud.id
  route_key = "GET /health"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "telemetry" {
  api_id    = aws_apigatewayv2_api.cloud.id
  route_key = "POST /v1/telemetry"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  # Agent token auth inside Lambda (not Cognito)
}

resource "aws_apigatewayv2_route" "console_proxy" {
  api_id             = aws_apigatewayv2_api.cloud.id
  route_key          = "ANY /v1/{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.cloud.id
  name        = "$default"
  auto_deploy = true
  # Access logging requires an API Gateway CloudWatch Logs role on the account;
  # enable after that one-time account setting is configured.
  default_route_settings {
    throttling_burst_limit = 200
    throttling_rate_limit  = 100
  }
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.cloud.execution_arn}/*/*"
}
