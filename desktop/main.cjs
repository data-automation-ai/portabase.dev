const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { appendFile, copyFile, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { listOrganizations, listProjects, createProject, projectCredentials } = require('./provisioning.cjs');
const { definitions: scheduleDefinitions } = require('./scheduler.cjs');

app.enableSandbox();

const ALLOWED_EXTERNAL = new Set([
  'https://supabase.com/dashboard/new/new-project',
  'https://supabase.com/dashboard/sign-up',
  'https://supabase.com/dashboard/account/tokens',
  'https://portabase.dev/buy',
]);
const COMMANDS = new Set(['doctor', 'backup', 'restore', 'verify', 'status', 'probe']);
const SECRET_KEYS = new Set([
  'SUPABASE_DB_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ACCESS_TOKEN', 'PORTABASE_ENCRYPTION_PASSPHRASE',
  'PORTABASE_TARGET_DB_URL', 'PORTABASE_TARGET_SUPABASE_URL',
  'PORTABASE_TARGET_SERVICE_ROLE_KEY', 'PORTABASE_TARGET_PROJECT_REF',
]);

function appRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : path.resolve(__dirname, '..');
}

function userFile(name) {
  return path.join(app.getPath('userData'), name);
}

function validateSender(event) {
  return event.senderFrame?.url === pathToFileURL(path.join(__dirname, 'index.html')).href;
}

async function readJson(file, fallback = {}) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

function secureBackend() {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'os';
  return backend === 'basic_text' ? null : backend;
}

async function loadSecrets() {
  const stored = await readJson(userFile('secrets.bin.json'));
  const values = {};
  if (!secureBackend()) return { values, secure: false };
  for (const [key, encoded] of Object.entries(stored)) {
    if (SECRET_KEYS.has(key) && typeof encoded === 'string') {
      try { values[key] = safeStorage.decryptString(Buffer.from(encoded, 'base64')); } catch { /* ignore invalid record */ }
    }
  }
  return { values, secure: true };
}

async function saveSecrets(values) {
  const backend = secureBackend();
  if (!backend) throw new Error('Secure operating-system credential storage is unavailable. Install/unlock a Linux keyring or enter secrets for this run only.');
  const encrypted = {};
  for (const [key, value] of Object.entries(values || {})) {
    if (SECRET_KEYS.has(key) && typeof value === 'string' && value) encrypted[key] = safeStorage.encryptString(value).toString('base64');
  }
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(userFile('secrets.bin.json'), `${JSON.stringify(encrypted, null, 2)}\n`, { mode: 0o600 });
  return { secure: true, backend };
}

function cliScript() {
  return path.join(appRoot(), 'utility', 'portabase.mjs');
}

function licenseFile() {
  return userFile('portabase.license.json');
}

async function inspectInstalledLicense(path = licenseFile()) {
  const modulePath = pathToFileURL(path.join(appRoot(), 'utility', 'license.mjs')).href;
  const { inspectLicense } = await import(modulePath);
  return inspectLicense(path, process.platform);
}

async function runCli(command, args, runtimeSecrets = {}, onChunk = null) {
  if (!COMMANDS.has(command)) throw new Error('Unsupported command.');
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string' || value.length > 2048)) throw new Error('Invalid arguments.');
  const saved = (await loadSecrets()).values;
  const envSecrets = Object.fromEntries(Object.entries({ ...saved, ...runtimeSecrets }).filter(([key]) => SECRET_KEYS.has(key)));
  const config = userFile('portabase.config.json');
  const finalArgs = [cliScript(), command, ...args];
  if (existsSync(config) && !args.includes('--config')) finalArgs.push('--config', config);
  const toolsDir = app.isPackaged ? path.join(process.resourcesPath, 'tools') : '';
  const toolPath = toolsDir ? [path.join(toolsDir, 'postgres', 'bin'), toolsDir, process.env.PATH || ''].join(path.delimiter) : process.env.PATH;
  const libraryPath = toolsDir ? path.join(toolsDir, 'postgres', 'lib') : '';
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, finalArgs, {
      cwd: appRoot(),
      env: {
        ...process.env, ...envSecrets, ELECTRON_RUN_AS_NODE: '1', PORTABASE_TOOLS_DIR: toolsDir, PATH: toolPath,
        PORTABASE_LICENSE_FILE: licenseFile(), PORTABASE_EVIDENCE_DIRECTORY: userFile('recovery-evidence'),
        ...(process.platform === 'linux' && libraryPath ? { LD_LIBRARY_PATH: [libraryPath, process.env.LD_LIBRARY_PATH || ''].filter(Boolean).join(':') } : {}),
        ...(process.platform === 'darwin' && libraryPath ? { DYLD_LIBRARY_PATH: [libraryPath, process.env.DYLD_LIBRARY_PATH || ''].filter(Boolean).join(':') } : {}),
      },
      shell: false,
      windowsHide: true,
    });
    let output = '';
    const receive = chunk => {
      output += chunk;
      if (onChunk) { try { onChunk(String(chunk)); } catch { /* renderer gone */ } }
    };
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    child.on('error', error => resolveRun({ code: -1, output: error.message }));
    child.on('close', code => resolveRun({ code, output: output.slice(-100000) }));
  });
}

function runProcess(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, ...options });
    let output = '';
    child.stdout?.on('data', chunk => { output += chunk; });
    child.stderr?.on('data', chunk => { output += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolveRun(output) : reject(new Error(output.trim() || `${path.basename(command)} exited with code ${code}`)));
  });
}

const CLOUD_REMOTES = { 'google-drive': ['portabase-gdrive', 'drive'], dropbox: ['portabase-dropbox', 'dropbox'] };

function bundledRclone() {
  const packaged = app.isPackaged ? path.join(process.resourcesPath, 'tools', process.platform === 'win32' ? 'rclone.exe' : 'rclone') : null;
  if (packaged && existsSync(packaged)) return packaged;
  return process.platform === 'win32' ? 'rclone.exe' : 'rclone';
}

async function connectCloud(provider) {
  const selected = CLOUD_REMOTES[provider];
  if (!selected) throw new Error('Unsupported cloud provider.');
  const [remote, type] = selected;
  await runProcess(bundledRclone(), ['config', 'create', remote, type], { timeout: 300000 });
  const remotes = await runProcess(bundledRclone(), ['listremotes']);
  if (!remotes.split(/\r?\n/).includes(`${remote}:`)) throw new Error('The cloud sign-in did not complete. Try again and approve access in your browser.');
  return { remote, provider };
}

async function installDesktopSchedule(everyHours) {
  if (!app.isPackaged) throw new Error('Build and install Portabase before installing its automatic schedule.');
  if (!existsSync(userFile('portabase.config.json'))) throw new Error('Save a project configuration before installing the schedule.');
  const secrets = await loadSecrets();
  if (!secrets.secure || !secrets.values.SUPABASE_DB_URL || !secrets.values.PORTABASE_ENCRYPTION_PASSPHRASE) throw new Error('Save the required credentials in protected operating-system storage before scheduling.');
  const definition = scheduleDefinitions({ platform: process.platform, executable: process.execPath, everyHours, home: app.getPath('home'), userData: app.getPath('userData') });
  if (process.platform === 'win32') {
    await runProcess('schtasks.exe', ['/Create', '/TN', definition.taskName, '/SC', 'HOURLY', '/MO', String(definition.hours), '/TR', definition.command, '/F']);
  } else if (process.platform === 'darwin') {
    await mkdir(path.dirname(definition.file), { recursive: true });
    await writeFile(definition.file, definition.content, { mode: 0o600 });
    const domain = `gui/${process.getuid()}`;
    await runProcess('launchctl', ['bootout', domain, definition.file]).catch(() => {});
    await runProcess('launchctl', ['bootstrap', domain, definition.file]);
  } else if (process.platform === 'linux') {
    await mkdir(definition.directory, { recursive: true });
    await writeFile(path.join(definition.directory, 'portabase-backup.service'), definition.service, { mode: 0o600 });
    await writeFile(path.join(definition.directory, 'portabase-backup.timer'), definition.timer, { mode: 0o600 });
    await runProcess('systemctl', ['--user', 'daemon-reload']);
    await runProcess('systemctl', ['--user', 'enable', '--now', 'portabase-backup.timer']);
  }
  return { installed: true, everyHours: definition.hours, platform: process.platform };
}

async function removeDesktopSchedule() {
  const definition = scheduleDefinitions({ platform: process.platform, executable: process.execPath, everyHours: 6, home: app.getPath('home'), userData: app.getPath('userData') });
  if (process.platform === 'win32') await runProcess('schtasks.exe', ['/Delete', '/TN', definition.taskName, '/F']).catch(() => {});
  else if (process.platform === 'darwin') {
    await runProcess('launchctl', ['bootout', `gui/${process.getuid()}`, definition.file]).catch(() => {});
    await rm(definition.file, { force: true });
  } else if (process.platform === 'linux') {
    await runProcess('systemctl', ['--user', 'disable', '--now', 'portabase-backup.timer']).catch(() => {});
    await rm(path.join(definition.directory, 'portabase-backup.service'), { force: true });
    await rm(path.join(definition.directory, 'portabase-backup.timer'), { force: true });
    await runProcess('systemctl', ['--user', 'daemon-reload']).catch(() => {});
  }
  return { removed: true };
}

async function runScheduledBackup() {
  const startedAt = new Date().toISOString();
  const result = await runCli('backup', []);
  await mkdir(app.getPath('userData'), { recursive: true });
  await appendFile(userFile('scheduled-backup.log'), `[${startedAt}] exit=${result.code}\n${result.output}\n`, { mode: 0o600 });
  return result.code;
}

function registerIpc() {
  ipcMain.handle('portabase:state', async event => {
    if (!validateSender(event)) throw new Error('Untrusted renderer.');
    const settings = await readJson(userFile('settings.json'));
    return {
      secureStorage: Boolean(secureBackend()),
      config: await readJson(userFile('portabase.config.json'), null),
      license: await inspectInstalledLicense(),
      comfortLevel: ['guided', 'standard', 'cli'].includes(settings.comfortLevel) ? settings.comfortLevel : null,
    };
  });
  ipcMain.handle('portabase:save-settings', async (event, settings) => {
    if (!validateSender(event)) throw new Error('Untrusted renderer.');
    const comfortLevel = ['guided', 'standard', 'cli'].includes(settings?.comfortLevel) ? settings.comfortLevel : null;
    if (!comfortLevel) throw new Error('Choose an experience level.');
    await mkdir(app.getPath('userData'), { recursive: true });
    await writeFile(userFile('settings.json'), `${JSON.stringify({ comfortLevel }, null, 2)}\n`, { mode: 0o600 });
    return { comfortLevel };
  });
  ipcMain.handle('portabase:list-projects', async (event, token) => {
    if (!validateSender(event)) throw new Error('Untrusted renderer.');
    return listProjects(token);
  });
  ipcMain.handle('portabase:connect-cloud', async (event, provider) => {
    if (!validateSender(event)) throw new Error('Untrusted renderer.');
    return connectCloud(String(provider || ''));
  });
  ipcMain.handle('portabase:save-config', async (event, config) => {
    if (!validateSender(event)) throw new Error('Untrusted renderer.');
    const cloud = CLOUD_REMOTES[config?.cloud] ? config.cloud : null;
    const clean = {
      version: 2,
      projectRef: String(config?.projectRef || '').trim(),
      backupDirectory: String(config?.backupDirectory || path.join(app.getPath('documents'), 'Portabase Capsules')),
      statusDirectory: String(config?.statusDirectory || path.join(app.getPath('userData'), 'status')),
      provider: cloud
        ? { type: cloud, remote: CLOUD_REMOTES[cloud][0], path: '/Portabase' }
        : { type: 'local', path: String(config?.destination || path.join(app.getPath('documents'), 'Portabase Independent Copy')) },
      capture: { database: true, storage: true, functions: true },
      encryption: { passphraseEnv: 'PORTABASE_ENCRYPTION_PASSPHRASE' },
      retention: { keepLast: 30, pruneAfterBackup: false },
      schedule: { everyHours: 6 },
    };
    if (!/^[a-z0-9]{20}$/.test(clean.projectRef)) throw new Error('Enter the 20-character Supabase project reference.');
    await writeFile(userFile('portabase.config.json'), `${JSON.stringify(clean, null, 2)}\n`, { mode: 0o600 });
    return clean;
  });
  ipcMain.handle('portabase:save-secrets', async (event, values) => {
    if (!validateSender(event)) throw new Error('Untrusted renderer.');
    return saveSecrets(values);
  });
  ipcMain.handle('portabase:run', async (event, request) => {
    if (!validateSender(event)) throw new Error('Untrusted renderer.');
    const sender = event.sender;
    return runCli(request?.command, request?.args || [], request?.secrets || {}, chunk => {
      if (!sender.isDestroyed()) sender.send('portabase:stream', chunk);
    });
  });
  ipcMain.handle('portabase:list-organizations', async (event, token) => {
    if (!validateSender(event)) throw new Error('Untrusted renderer.');
    return listOrganizations(token);
  });
  ipcMain.handle('portabase:create-project', async (event, request) => {
    if (!validateSender(event)) throw new Error('Untrusted renderer.');
    return createProject(request?.token, request);
  });
  ipcMain.handle('portabase:project-credentials', async (event, request) => {
    if (!validateSender(event)) throw new Error('Untrusted renderer.');
    return projectCredentials(request?.token, request?.ref, request?.dbPassword);
  });
  ipcMain.handle('portabase:choose-directory', async event => {
    if (!validateSender(event)) throw new Error('Untrusted renderer.');
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('portabase:choose-capsule', async event => {
    if (!validateSender(event)) throw new Error('Untrusted renderer.');
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('portabase:import-license', async event => {
    if (!validateSender(event)) throw new Error('Untrusted renderer.');
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Portabase license', extensions: ['json'] }] });
    if (result.canceled) return null;
    const selected = result.filePaths[0];
    const license = await inspectInstalledLicense(selected);
    if (!license.valid) throw new Error(`License rejected: ${license.reason}.`);
    await mkdir(app.getPath('userData'), { recursive: true });
    await copyFile(selected, licenseFile());
    return license;
  });
  ipcMain.handle('portabase:install-schedule', async (event, everyHours) => {
    if (!validateSender(event)) throw new Error('Untrusted renderer.');
    return installDesktopSchedule(everyHours);
  });
  ipcMain.handle('portabase:remove-schedule', async event => {
    if (!validateSender(event)) throw new Error('Untrusted renderer.');
    return removeDesktopSchedule();
  });
  ipcMain.handle('portabase:open', async (event, url) => {
    const projectSettingsPage = /^https:\/\/supabase\.com\/dashboard\/project\/[a-z0-9]{20}\/settings\/database$/.test(String(url));
    if (!validateSender(event) || (!ALLOWED_EXTERNAL.has(url) && !projectSettingsPage)) throw new Error('External link is not allowed.');
    await shell.openExternal(url);
    return true;
  });
  ipcMain.handle('portabase:open-report', async (event, reportPath) => {
    if (!validateSender(event)) throw new Error('Untrusted renderer.');
    if (typeof reportPath !== 'string' || reportPath.length > 2048) throw new Error('Invalid report path.');
    const resolved = path.resolve(reportPath.trim());
    const isTrialReport = path.basename(resolved) === 'TRIAL-REPORT.html';
    const isEvidence = resolved.startsWith(userFile('recovery-evidence') + path.sep) && resolved.endsWith('.html');
    if ((!isTrialReport && !isEvidence) || !existsSync(resolved)) throw new Error('Only Portabase-generated reports can be opened.');
    const problem = await shell.openPath(resolved);
    if (problem) throw new Error(problem);
    return true;
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100, height: 780, minWidth: 860, minHeight: 640,
    backgroundColor: '#0d0e11',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  // Launch desktop is Windows 11 (win32) only — do not ship or run the packaged Mac app.
  if (app.isPackaged && process.platform !== 'win32') {
    dialog.showErrorBox(
      'Windows 11 only',
      'This Portabase desktop build supports Windows 11 only. On Mac or Linux, use the open-source CLI (utility/portabase.mjs).',
    );
    app.exit(1);
    return;
  }
  if (process.argv.includes('--scheduled-backup')) {
    const code = await runScheduledBackup().catch(async error => {
      await appendFile(userFile('scheduled-backup.log'), `[${new Date().toISOString()}] FAILED ${error.message}\n`, { mode: 0o600 }).catch(() => {});
      return 1;
    });
    app.exit(code);
    return;
  }
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { app.quit(); });
