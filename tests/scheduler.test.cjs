const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { definitions } = require('../desktop/scheduler.cjs');

test('desktop schedules launch the application headlessly without embedding secrets', () => {
  const executable = path.resolve('Portabase.exe');
  const windows = definitions({ platform: 'win32', executable, everyHours: 6, home: path.resolve('home'), userData: path.resolve('data') });
  assert.match(windows.command, /--scheduled-backup/);
  assert.doesNotMatch(windows.command, /SUPABASE|PASSWORD|TOKEN/);
  const linux = definitions({ platform: 'linux', executable, everyHours: 6, home: path.resolve('home'), userData: path.resolve('data') });
  assert.match(linux.service, /--scheduled-backup/);
  assert.match(linux.timer, /OnUnitActiveSec=6h/);
  const mac = definitions({ platform: 'darwin', executable, everyHours: 6, home: path.resolve('home'), userData: path.resolve('data') });
  assert.match(mac.content, /<integer>21600<\/integer>/);
});
