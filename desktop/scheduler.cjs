const path = require('node:path');

function validateHours(value) {
  const hours = Number(value);
  if (!Number.isInteger(hours) || hours < 1 || hours > 24) throw new Error('Schedule must run every 1 through 24 hours.');
  return hours;
}

function xml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

function definitions({ platform, executable, everyHours, home, userData }) {
  const hours = validateHours(everyHours);
  if (!path.isAbsolute(executable)) throw new Error('Scheduled executable must be an absolute path.');
  if (platform === 'win32') {
    return { taskName: 'PortaBase Automatic Backup', command: `"${executable}" --scheduled-backup`, hours };
  }
  if (platform === 'darwin') {
    const file = path.join(home, 'Library', 'LaunchAgents', 'dev.portabase.backup.plist');
    const log = path.join(userData, 'scheduled-backup.log');
    const content = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>dev.portabase.backup</string><key>ProgramArguments</key><array><string>${xml(executable)}</string><string>--scheduled-backup</string></array><key>StartInterval</key><integer>${hours * 3600}</integer><key>StandardOutPath</key><string>${xml(log)}</string><key>StandardErrorPath</key><string>${xml(log)}</string></dict></plist>\n`;
    return { label: 'dev.portabase.backup', file, content, hours };
  }
  if (platform === 'linux') {
    const directory = path.join(home, '.config', 'systemd', 'user');
    const service = `[Unit]\nDescription=PortaBase automatic encrypted backup\nAfter=network-online.target\n\n[Service]\nType=oneshot\nExecStart="${executable.replaceAll('"', '\\"')}" --scheduled-backup\nNoNewPrivileges=true\nPrivateTmp=true\n`;
    const timer = `[Unit]\nDescription=Run PortaBase automatically\n\n[Timer]\nOnBootSec=15min\nOnUnitActiveSec=${hours}h\nPersistent=true\nRandomizedDelaySec=5min\n\n[Install]\nWantedBy=timers.target\n`;
    return { directory, service, timer, hours };
  }
  throw new Error(`Unsupported scheduling platform: ${platform}`);
}

module.exports = { definitions, validateHours };
