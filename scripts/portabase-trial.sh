#!/usr/bin/env bash
# PortaBase limited trial — Linux/macOS one-command runner.
# Runs the real backup workflow with trial limits, then opens the protection ledger.
# Nothing is transmitted to PortaBase: credentials come from your environment,
# the capsule is encrypted locally, and the report is written to local disk.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cli="$here/utility/portabase.mjs"

fail() { printf 'portabase-trial: %s\n' "$1" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail 'Node.js 20+ is required (https://nodejs.org).'
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' \
  || fail "Node.js 20+ is required; found $(node --version)."
[ -f "$cli" ] || fail "PortaBase CLI not found at $cli"

# Optional tools: report presence, do not block (the CLI degrades gracefully).
for tool in pg_dump psql tar; do
  command -v "$tool" >/dev/null 2>&1 || printf 'note: %s not found — the doctor step will explain what that limits.\n' "$tool"
done

prompt_secret() { # $1=env name, $2=prompt
  if [ -z "${!1:-}" ]; then
    read -r -s -p "$2: " value; printf '\n'
    [ -n "$value" ] || fail "$1 is required."
    export "$1"="$value"
  fi
}

if [ ! -f "$here/portabase.config.json" ] && [ -z "${PORTABASE_RUNTIME_CONFIG:-}" ]; then
  read -r -p 'Supabase project ref (20 characters): ' project_ref
  node "$cli" init --project-ref "$project_ref" --provider local --path ''
fi

prompt_secret SUPABASE_DB_URL     'Database connection URL (postgresql://...)'
prompt_secret SUPABASE_URL        'Project URL (https://PROJECT.supabase.co)'
prompt_secret SUPABASE_SERVICE_ROLE_KEY 'Service-role / secret key'
prompt_secret PORTABASE_ENCRYPTION_PASSPHRASE 'Encryption passphrase (16+ characters)'
if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  printf 'note: SUPABASE_ACCESS_TOKEN not set — Edge Function capture and the secrets checklist will be skipped.\n'
fi

node "$cli" doctor || printf 'note: doctor reported gaps; the trial will mark anything it cannot capture.\n'
output="$(node "$cli" backup --trial | tee /dev/tty)"

report="$(printf '%s\n' "$output" | sed -n 's/^TRIAL REPORT: //p' | tail -n 1)"
if [ -n "$report" ] && [ -f "$report" ]; then
  printf '\nProtection ledger: %s\n' "$report"
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$report" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then open "$report" || true
  fi
fi
