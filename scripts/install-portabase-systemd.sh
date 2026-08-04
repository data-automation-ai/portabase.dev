#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="/opt/portabase"
ENV_DIR="/etc/portabase"

apt-get update
apt-get install -y nodejs npm postgresql-client rclone tar
id portabase >/dev/null 2>&1 || useradd --system --home "${INSTALL_DIR}" --shell /usr/sbin/nologin portabase
install -d -o portabase -g portabase "${INSTALL_DIR}" "${INSTALL_DIR}/portabase-capsules" "${INSTALL_DIR}/portabase-status"
install -m 644 "${SOURCE_DIR}/package.json" "${SOURCE_DIR}/package-lock.json" "${INSTALL_DIR}/"
cp -a "${SOURCE_DIR}/utility" "${INSTALL_DIR}/utility"
cd "${INSTALL_DIR}"
npm ci --omit=dev
chown -R portabase:portabase "${INSTALL_DIR}"

install -d -m 700 "${ENV_DIR}"
if [[ ! -f "${ENV_DIR}/portabase.env" ]]; then
  cat > "${ENV_DIR}/portabase.env" <<'ENV'
SUPABASE_DB_URL=REPLACE_ME
SUPABASE_URL=REPLACE_ME
SUPABASE_SERVICE_ROLE_KEY=REPLACE_ME
SUPABASE_ACCESS_TOKEN=REPLACE_ME
PORTABASE_ENCRYPTION_PASSPHRASE=REPLACE_WITH_AT_LEAST_16_CHARACTERS
PORTABASE_LICENSE_ENVELOPE_BASE64=REPLACE_WITH_BASE64_ENCODED_LINUX_LICENSE_JSON
ENV
  chmod 600 "${ENV_DIR}/portabase.env"
fi

cat > /etc/systemd/system/portabase-backup.service <<'SERVICE'
[Unit]
Description=Portabase encrypted Supabase recovery capture
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=portabase
Group=portabase
WorkingDirectory=/opt/portabase
EnvironmentFile=/etc/portabase/portabase.env
ExecStart=/usr/bin/node /opt/portabase/utility/portabase.mjs backup
PrivateTmp=true
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/portabase/portabase-capsules /opt/portabase/portabase-status
SERVICE

cat > /etc/systemd/system/portabase-backup.timer <<'TIMER'
[Unit]
Description=Run Portabase every six hours

[Timer]
OnBootSec=15min
OnUnitActiveSec=6h
Persistent=true
RandomizedDelaySec=5min

[Install]
WantedBy=timers.target
TIMER

systemctl daemon-reload
echo "Installed but not enabled. Replace every REPLACE_ME value, add portabase.config.json, run one manual backup, then enable portabase-backup.timer."
