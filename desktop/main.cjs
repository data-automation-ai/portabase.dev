const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { listOrganizations, createProject, projectCredentials } = require('./provisioning.cjs');

app.enableSandbox();

const ALLOWED_EXTERNAL = new Set([
  'https://supabase.com/dashboard/new/new-project',
  'https://supabase.com/dashboard/sign-up',
  'https://supabase.com/dashboard/account/tokens',
  'https://portabase.dev/buy',
]);
const COMMANDS = new Set(['doctor', 'backup', 'restore', 'verify', 'status']);
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

async function runCli(command, args, runtimeSecrets = {}) {
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
        ...(process.platform === 'linux' && libraryPath ? { LD_LIBRARY_PATH: [libraryPath, process.env.LD_LIBRARY_PATH || ''].filter(Boolean).join(':') } : {}),
        ...(process.platform === 'darwin' && libraryPath ? { DYLD_LIBRARY_PATH: [libraryPath, process.env.DYLD_LIBRARY_PATH || ''].filter(Boolean).join(':') } : {}),
      },
      shell: false,
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => resolveRun({ code: -1, output: error.message }));
    child.on('close', code => resolveRun({ code, output: output.slice(-100000) }));
  });
}

function registerIpc() {
  ipcMain.handle('portabase:state', async event => {
    if (!validateSender(event)) throw new Error('Untrusted renderer.');
    return { secureStorage: Boolean(secureBackend()), config: await readJson(userFile('portabase.config.json'), null) };
  });
  ipcMain.handle('portabase:save-config', async (event, config) => {
    if (!validateSender(event)) throw new Error('Untrusted renderer.');
    const clean = {
      version: 2,
      projectRef: String(config?.projectRef || '').trim(),
      backupDirectory: String(config?.backupDirectory || path.join(app.getPath('documents'), 'PortaBase Capsules')),
      statusDirectory: String(config?.statusDirectory || path.join(app.getPath('userData'), 'status')),
      provider: { type: 'local', path: String(config?.destination || path.join(app.getPath('documents'), 'PortaBase Independent Copy')) },
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
    return runCli(request?.command, request?.args || [], request?.secrets || {});
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
  ipcMain.handle('portabase:open', async (event, url) => {
    if (!validateSender(event) || !ALLOWED_EXTERNAL.has(url)) throw new Error('External link is not allowed.');
    await shell.openExternal(url);
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

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
