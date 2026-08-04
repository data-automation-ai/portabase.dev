resource "aws_kms_key" "secrets" {
  description             = "Portabase Cloud secrets encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = { Name = "${local.name_prefix}-secrets-kms" }
}

resource "aws_kms_alias" "secrets" {
  name          = "alias/${local.name_prefix}-secrets"
  target_key_id = aws_kms_key.secrets.key_id
}

# Placeholder secret for control-plane Supabase service role (fill value out of band)
resource "aws_secretsmanager_secret" "supabase_service" {
  name       = "${local.name_prefix}/control-plane/supabase-service-role"
  kms_key_id = aws_kms_key.secrets.arn
  tags       = { Name = "${local.name_prefix}-supabase-service" }
}

resource "aws_secretsmanager_secret" "telemetry_ingest" {
  name       = "${local.name_prefix}/control-plane/telemetry-ingest-token"
  kms_key_id = aws_kms_key.secrets.arn
  tags       = { Name = "${local.name_prefix}-telemetry-ingest" }
}
