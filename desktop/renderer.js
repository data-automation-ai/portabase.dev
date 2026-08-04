const $ = id => document.getElementById(id);
const secretValues = () => ({
  SUPABASE_DB_URL: $('sourceDb').value, SUPABASE_URL: $('sourceUrl').value,
  SUPABASE_SERVICE_ROLE_KEY: $('sourceService').value, SUPABASE_ACCESS_TOKEN: $('sourceAccess').value,
  PORTABASE_ENCRYPTION_PASSPHRASE: $('passphrase').value,
});
const targetValues = () => ({
  PORTABASE_TARGET_DB_URL: $('targetDb').value, PORTABASE_TARGET_SUPABASE_URL: $('targetUrl').value,
  PORTABASE_TARGET_SERVICE_ROLE_KEY: $('targetService').value, PORTABASE_TARGET_PROJECT_REF: $('targetRef').value,
  SUPABASE_ACCESS_TOKEN: $('targetAccess').value, PORTABASE_ENCRYPTION_PASSPHRASE: $('passphrase').value,
});

function show(page) {
  document.querySelectorAll('.page,.nav').forEach(el => el.classList.remove('active'));
  $(page).classList.add('active');
  document.querySelector(`.nav[data-page="${page}"]`)?.classList.add('active');
}

/* ---- Live flow visualization ---- */
const flow = { running: false, phase: 'idle', item: '', particles: [], done: false, failed: false, tables: [], tableTotal: 0, tableIndex: 0, chips: [], lastChipAt: 0 };
const formatRows = rows => rows >= 1e6 ? `${(rows / 1e6).toFixed(1)}M` : rows >= 1e3 ? `${(rows / 1e3).toFixed(1)}k` : String(rows);
const PHASE_TEXT = {
  capture: item => `Preparing to capture ${item}…`,
  database: item => item?.includes('.') ? `Reading table ${item}` : `Capturing database ${item || ''}`,
  scan: item => `Scanning bucket “${item}” — counting every file`,
  storage: item => `Securing file ${item}`,
  functions: item => `Packing Edge Function “${item}”`,
  encrypt: () => 'Sealing the capsule — AES-256 encryption',
  transfer: item => `Moving the encrypted capsule to your ${item === 'local' ? 'independent folder' : item} vault`,
  done: () => 'Protected. Verified. Yours.',
  failed: item => `Stopped: ${item}`,
};
function setFlow(phase, item) {
  flow.phase = phase; flow.item = item || '';
  flow.done = phase === 'done'; flow.failed = phase === 'failed';
  flow.running = !flow.done && !flow.failed && phase !== 'idle';
  if (phase !== 'database') { flow.chips = []; }
  if (phase === 'idle' || phase === 'capture') { flow.tables = []; flow.tableTotal = 0; flow.tableIndex = 0; }
  const text = PHASE_TEXT[phase] ? PHASE_TEXT[phase](item) : 'Working…';
  $('flowLabel').textContent = text;
  $('flowLabel').classList.toggle('good', flow.done);
  $('flowLabel').classList.toggle('bad', flow.failed);
}
function announceTable(index) {
  const table = flow.tables[index];
  if (!table) return;
  $('flowLabel').textContent = `Capturing your table ${Math.min(index + 1, flow.tableTotal)} of ${flow.tableTotal} — ${table.item} (~${formatRows(table.rows)} rows)`;
}
function drawFlow() {
  const canvas = $('flowCanvas');
  const context = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height, midY = h / 2;
  const nodes = [
    { x: 90, label: 'YOUR APP', sub: 'Supabase', color: '#3ecf8e' },
    { x: w / 2, label: 'ENCRYPT', sub: 'on this computer', color: '#c9ff4a' },
    { x: w - 90, label: 'YOUR VAULT', sub: 'only you hold the key', color: '#c9ff4a' },
  ];
  context.clearRect(0, 0, w, h);
  context.strokeStyle = '#2b2f36'; context.lineWidth = 2;
  context.beginPath(); context.moveTo(nodes[0].x + 52, midY); context.lineTo(nodes[2].x - 52, midY); context.stroke();
  if (flow.running && flow.particles.length < 46 && Math.random() < 0.5) {
    const firstLeg = flow.phase !== 'transfer';
    flow.particles.push({ x: firstLeg ? nodes[0].x + 52 : nodes[1].x, leg: firstLeg ? 0 : 1, speed: 2 + Math.random() * 2.5, drift: (Math.random() - 0.5) * 26 });
  }
  if (flow.phase === 'database' && flow.tables.length && flow.chips.length < 3 && performance.now() - flow.lastChipAt > 420) {
    const table = flow.tables[flow.tableIndex % flow.tables.length];
    flow.chips.push({ text: `${table.item} · ${formatRows(table.rows)} rows`, x: nodes[0].x + 56, lane: (flow.tableIndex % 3) - 1 });
    announceTable(flow.tableIndex);
    flow.tableIndex += 1;
    flow.lastChipAt = performance.now();
  }
  flow.chips = flow.chips.filter(chip => {
    chip.x += 2.1;
    if (chip.x >= nodes[1].x - 58) return false;
    const y = midY + chip.lane * 26 - 13;
    context.font = '10px ui-monospace,Consolas,monospace';
    const width = context.measureText(chip.text).width + 14;
    context.globalAlpha = 0.92;
    context.fillStyle = '#10241b'; context.strokeStyle = '#3ecf8e'; context.lineWidth = 1;
    context.beginPath(); context.roundRect(chip.x, y, width, 19, 9); context.fill(); context.stroke();
    context.fillStyle = '#9fe8c6'; context.textAlign = 'left';
    context.fillText(chip.text, chip.x + 7, y + 13);
    context.globalAlpha = 1;
    return true;
  });
  flow.particles = flow.particles.filter(p => {
    p.x += p.speed;
    const end = p.leg === 0 ? nodes[1].x : nodes[2].x - 52;
    if (p.x >= end) { if (p.leg === 0 && (flow.phase === 'encrypt' || flow.phase === 'transfer' || flow.phase === 'done')) { p.leg = 1; return true; } return false; }
    const wave = Math.sin(p.x / 26) * (p.leg === 0 ? p.drift : p.drift * 0.35);
    context.fillStyle = p.leg === 0 ? '#3ecf8e' : '#c9ff4a';
    context.beginPath(); context.arc(p.x, midY + wave, p.leg === 0 ? 3 : 2.4, 0, Math.PI * 2); context.fill();
    return true;
  });
  for (const node of nodes) {
    const glow = flow.running || flow.done ? 0.9 : 0.45;
    context.globalAlpha = glow;
    context.fillStyle = '#15171c'; context.strokeStyle = node.color;
    context.beginPath(); context.roundRect(node.x - 52, midY - 34, 104, 68, 9); context.fill(); context.stroke();
    context.globalAlpha = 1;
    context.fillStyle = '#f4f1e9'; context.font = '700 12px system-ui'; context.textAlign = 'center';
    context.fillText(node.label, node.x, midY - 4);
    context.fillStyle = '#9a9b96'; context.font = '10px system-ui';
    context.fillText(node.sub, node.x, midY + 14);
  }
  if (flow.done) {
    context.fillStyle = '#c9ff4a'; context.font = '700 15px system-ui'; context.textAlign = 'center';
    context.fillText('✓ VERIFIED', nodes[2].x, midY - 46);
  }
  requestAnimationFrame(drawFlow);
}
requestAnimationFrame(drawFlow);

/* ---- Streaming output ---- */
let streamBuffer = '';
let streaming = false;
window.portabase.onStream(chunk => {
  if (!streaming) return;
  streamBuffer += chunk;
  const lines = streamBuffer.split('\n');
  streamBuffer = lines.pop();
  for (const line of lines) {
    if (line.startsWith('@portabase ')) {
      try {
        const event = JSON.parse(line.slice(11));
        if (event.phase === 'database-manifest') {
          flow.tables = Array.isArray(event.tables) ? event.tables : [];
          flow.tableTotal = Number(event.count) || flow.tables.length;
          flow.tableIndex = 0;
        } else if (event.phase === 'database' && String(event.item || '').includes('.')) {
          const exact = flow.tables.findIndex(table => table.item === event.item);
          if (exact >= 0) flow.tableIndex = exact;
          setFlow('database', event.item);
          announceTable(exact >= 0 ? exact : flow.tableIndex);
        } else {
          setFlow(event.phase, event.item ?? event.status);
        }
      } catch { /* ignore malformed event */ }
    } else if (line.trim()) {
      $('output').textContent += `${line}\n`;
    }
  }
});

let lastReportPath = null;
function result(text, failed = false) {
  $('output').textContent = text || 'Task finished without output.';
  $('output').classList.toggle('failed', failed);
  const match = [...String(text || '').matchAll(/(?:TRIAL REPORT|HUMAN REPORT): (.+\.html)\s*$/gm)].at(-1);
  lastReportPath = match ? match[1].trim() : null;
  $('openReport').hidden = !lastReportPath;
  $('openReport').textContent = lastReportPath && lastReportPath.endsWith('TRIAL-REPORT.html') ? 'Open the trial protection ledger' : 'Open the recovery evidence report';
  show('results');
}
async function run(command, args, secrets) {
  const animated = command === 'backup' || command === 'restore';
  const finalArgs = animated ? [...args, '--progress'] : args;
  streaming = true; streamBuffer = '';
  $('output').textContent = ''; $('output').classList.remove('failed');
  if (animated) setFlow('capture', 'your app'); else $('flowLabel').textContent = 'Running a local check…';
  show('results');
  const response = await window.portabase.run({ command, args: finalArgs, secrets });
  streaming = false;
  if (animated) setFlow(response.code === 0 ? 'done' : 'failed', response.code === 0 ? '' : 'see the log below');
  result(response.output.split('\n').filter(line => !line.startsWith('@portabase ')).join('\n'), response.code !== 0);
  return response;
}
$('openReport').addEventListener('click', async () => {
  try { if (lastReportPath) await window.portabase.openReport(lastReportPath); }
  catch (error) { $('output').textContent = `${$('output').textContent}\n\n${error.message}`; }
});

/* ---- Navigation + comfort levels ---- */
document.querySelectorAll('.nav').forEach(button => button.addEventListener('click', () => show(button.dataset.page)));
const HOME_PAGE = { guided: 'guided', standard: 'protect', cli: 'cli' };
document.querySelectorAll('.comfortCard').forEach(card => card.addEventListener('click', async () => {
  try {
    const level = card.dataset.level;
    await window.portabase.saveSettings({ comfortLevel: level });
    show(HOME_PAGE[level]);
  } catch (error) { result(error.message, true); }
}));

/* ---- Guided wizard ---- */
const guided = { token: '', projects: [], credentials: null };
const unlock = (id, on = true) => $(id).classList.toggle('locked', !on);
function guidedStatus(id, message, good = false) { const el = $(id); el.textContent = message; el.classList.toggle('good', good); }
$('gOpenTokens').addEventListener('click', () => window.portabase.open('https://supabase.com/dashboard/account/tokens'));
$('gConnect').addEventListener('click', async () => {
  try {
    guidedStatus('gStep1Status', 'Connecting directly to Supabase…');
    guided.token = $('gToken').value.trim();
    guided.projects = await window.portabase.listProjects(guided.token);
    if (!guided.projects.length) { guidedStatus('gStep1Status', 'Connected, but no apps were found on this account.'); return; }
    $('gProject').replaceChildren(new Option('Choose your app', ''), ...guided.projects.map(p => new Option(`${p.name} (${p.region || 'region unknown'})`, p.ref)));
    guidedStatus('gStep1Status', `Connected. Found ${guided.projects.length} app${guided.projects.length === 1 ? '' : 's'} — nicely done.`, true);
    unlock('gStep2');
  } catch (error) { guidedStatus('gStep1Status', error.message); }
});
$('gOpenDbSettings').addEventListener('click', () => {
  const ref = $('gProject').value;
  if (!ref) return guidedStatus('gStep2Status', 'Choose your app first, then open its password page.');
  window.portabase.open(`https://supabase.com/dashboard/project/${ref}/settings/database`);
});
$('gPrepare').addEventListener('click', async () => {
  try {
    const ref = $('gProject').value;
    if (!ref) return guidedStatus('gStep2Status', 'Choose your app from the list.');
    guidedStatus('gStep2Status', 'Fetching your app’s connection details from Supabase…');
    guided.credentials = await window.portabase.projectCredentials({ token: guided.token, ref, dbPassword: $('gDbPassword').value });
    guidedStatus('gStep2Status', 'Testing the database connection on this computer…');
    const probeRun = await window.portabase.run({ command: 'probe', args: ['--target', 'db'], secrets: { SUPABASE_DB_URL: guided.credentials.dbUrl } });
    const verdict = JSON.parse(probeRun.output.trim().split('\n').findLast(line => line.startsWith('{')) || '{}');
    if (!verdict.ok) { guided.credentials = null; return guidedStatus('gStep2Status', `Almost — ${verdict.probes?.db?.detail || 'the database connection failed'}. Double-check the password (Reset it on the password page if unsure).`); }
    guidedStatus('gStep2Status', 'Your app answered. Connection verified.', true);
    unlock('gStep3');
  } catch (error) { guided.credentials = null; guidedStatus('gStep2Status', error.message); }
});
$('gGenerate').addEventListener('click', () => {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(25));
  $('gPassphrase').value = Array.from(bytes, b => alphabet[b % alphabet.length]).join('').replace(/(.{5})(?!$)/g, '$1-');
  guidedStatus('gStep3Status', 'Generated. Save it somewhere safe now, then tick the box.');
});
$('gSaved').addEventListener('change', () => {
  const ready = $('gSaved').checked && $('gPassphrase').value.length >= 16;
  unlock('gStep4', ready);
  guidedStatus('gStep3Status', ready ? 'Passphrase confirmed. One step left.' : 'Generate and save your passphrase to continue.', ready);
});
const DEST_LABEL = {
  null: 'Backups will be kept in your Documents folder.',
  'google-drive': 'Connected. Backups will be verified inside your Google Drive.',
  dropbox: 'Connected. Backups will be verified inside your Dropbox.',
};
guided.cloud = null;
async function chooseGuidedCloud(provider, button) {
  try {
    if (provider) {
      guidedStatus('gDestStatus', 'Your browser is opening — sign in and approve access. Portabase never sees that password.');
      await window.portabase.connectCloud(provider);
    }
    guided.cloud = provider;
    document.querySelectorAll('#gStep4 .destChoice button').forEach(b => b.classList.toggle('selected', b === button));
    guidedStatus('gDestStatus', DEST_LABEL[provider], Boolean(provider));
  } catch (error) { guidedStatus('gDestStatus', error.message); }
}
$('gDestLocal').addEventListener('click', () => chooseGuidedCloud(null, $('gDestLocal')));
$('gDestDrive').addEventListener('click', () => chooseGuidedCloud('google-drive', $('gDestDrive')));
$('gDestDropbox').addEventListener('click', () => chooseGuidedCloud('dropbox', $('gDestDropbox')));
async function guidedSaveAll() {
  const ref = $('gProject').value;
  await window.portabase.saveConfig({ projectRef: ref, destination: '', cloud: guided.cloud });
  await window.portabase.saveSecrets({
    SUPABASE_DB_URL: guided.credentials.dbUrl, SUPABASE_URL: guided.credentials.url,
    SUPABASE_SERVICE_ROLE_KEY: guided.credentials.adminKey, SUPABASE_ACCESS_TOKEN: guided.token,
    PORTABASE_ENCRYPTION_PASSPHRASE: $('gPassphrase').value,
  });
}
$('gProtect').addEventListener('click', async () => {
  try {
    if (!guided.credentials) return guidedStatus('gStep4Status', 'Finish step 2 first — Portabase needs a verified connection.');
    guidedStatus('gStep4Status', 'Saving everything into protected local storage…');
    await guidedSaveAll();
    const state = await window.portabase.state();
    await run('backup', [], {
      SUPABASE_DB_URL: guided.credentials.dbUrl, SUPABASE_URL: guided.credentials.url,
      SUPABASE_SERVICE_ROLE_KEY: guided.credentials.adminKey, SUPABASE_ACCESS_TOKEN: guided.token,
      PORTABASE_ENCRYPTION_PASSPHRASE: $('gPassphrase').value,
    });
  } catch (error) { guidedStatus('gStep4Status', error.message); }
});
$('gSchedule').addEventListener('click', async () => {
  try {
    if (!guided.credentials) return guidedStatus('gStep4Status', 'Run “Protect my app now” first.');
    await guidedSaveAll();
    const schedule = await window.portabase.installSchedule(6);
    guidedStatus('gStep4Status', `Done — your app is now protected automatically every ${schedule.everyHours} hours.`, true);
  } catch (error) { guidedStatus('gStep4Status', error.message); }
});

/* ---- Standard + recovery pages (unchanged behavior) ---- */
let standardCloud = null;
async function connectStandardCloud(provider) {
  try {
    $('cloudStatus').textContent = 'Browser opening — approve access…';
    await window.portabase.connectCloud(provider);
    standardCloud = provider;
    $('cloudStatus').textContent = `${provider === 'google-drive' ? 'Google Drive' : 'Dropbox'} connected — Save securely to use it.`;
  } catch (error) { $('cloudStatus').textContent = error.message; }
}
$('connectDrive').addEventListener('click', () => connectStandardCloud('google-drive'));
$('connectDropbox').addEventListener('click', () => connectStandardCloud('dropbox'));
document.querySelector('[data-pick="destination"]').addEventListener('click', async () => {
  const picked = await window.portabase.chooseDirectory();
  if (picked) { $('destination').value = picked; standardCloud = null; $('cloudStatus').textContent = ''; }
});
document.querySelector('[data-pick="capsule"]').addEventListener('click', async () => { $('capsule').value = await window.portabase.chooseCapsule() || $('capsule').value; });
$('buy').addEventListener('click', () => window.portabase.open('https://portabase.dev/#cloud'));
$('newAccount').addEventListener('click', () => window.portabase.open('https://supabase.com/dashboard/sign-up'));
$('newToken').addEventListener('click', () => window.portabase.open('https://supabase.com/dashboard/account/tokens'));
$('loadOrgs').addEventListener('click', async () => {
  try {
    $('provisionStatus').textContent = 'Connecting directly to Supabase…';
    const organizations = await window.portabase.listOrganizations($('targetAccess').value);
    $('targetOrg').replaceChildren(new Option('Choose an organization', ''), ...organizations.map(org => new Option(org.name, org.slug)));
    $('provisionStatus').textContent = `Connected. Found ${organizations.length} organization${organizations.length === 1 ? '' : 's'}.`;
  } catch (error) { $('provisionStatus').textContent = error.message; }
});
$('createProject').addEventListener('click', async () => {
  try {
    if (!confirm('Create a blank Supabase project in the selected organization? This may affect that organization’s Supabase billing. No data will be restored until a separate write guard is confirmed.')) return;
    $('provisionStatus').textContent = 'Supabase is creating the blank recovery project…';
    const project = await window.portabase.createProject({ token: $('targetAccess').value, organizationSlug: $('targetOrg').value, name: $('targetName').value, region: $('targetRegion').value, dbPassword: $('targetDbPassword').value });
    $('targetRef').value = project.ref; $('targetUrl').value = project.url;
    $('provisionStatus').textContent = `Created ${project.ref} (${project.status}). When Supabase finishes provisioning it, click Prepare credentials.`;
  } catch (error) { $('provisionStatus').textContent = error.message; }
});
$('refreshProject').addEventListener('click', async () => {
  try {
    $('provisionStatus').textContent = 'Reading the new project credentials directly from Supabase…';
    const project = await window.portabase.projectCredentials({ token: $('targetAccess').value, ref: $('targetRef').value, dbPassword: $('targetDbPassword').value });
    $('targetRef').value = project.ref; $('targetUrl').value = project.url; $('targetDb').value = project.dbUrl; $('targetService').value = project.adminKey;
    $('provisionStatus').textContent = `Credentials prepared locally. Project status: ${project.status}. Run the no-write plan next.`;
  } catch (error) { $('provisionStatus').textContent = error.message; }
});
$('saveSource').addEventListener('click', async () => {
  try {
    await window.portabase.saveConfig({ projectRef: $('projectRef').value, destination: $('destination').value, cloud: standardCloud });
    await window.portabase.saveSecrets(secretValues());
    result('Saved locally using protected operating-system storage. Portabase did not transmit these values.');
  } catch (error) { result(error.message, true); }
});
$('doctor').addEventListener('click', async () => {
  try { await window.portabase.saveConfig({ projectRef: $('projectRef').value, destination: $('destination').value, cloud: standardCloud }); await run('doctor', [], secretValues()); }
  catch (error) { result(error.message, true); }
});
$('trial').addEventListener('click', async () => {
  try { await window.portabase.saveConfig({ projectRef: $('projectRef').value, destination: $('destination').value, cloud: standardCloud }); await run('backup', ['--trial'], secretValues()); }
  catch (error) { result(error.message, true); }
});
$('fullBackup').addEventListener('click', async () => {
  try { await window.portabase.saveConfig({ projectRef: $('projectRef').value, destination: $('destination').value, cloud: standardCloud }); await run('backup', [], secretValues()); }
  catch (error) { result(error.message, true); }
});
$('importLicense').addEventListener('click', async () => {
  try {
    const license = await window.portabase.importLicense();
    if (!license) return;
    $('licenseStatus').textContent = `Legacy license file stored · ${license.payload.platform} (not required for full capture)`;
    result('Legacy license file verified and stored. Open-core Portabase does not require a license for full backups.');
  } catch (error) { result(error.message, true); }
});
$('installSchedule').addEventListener('click', async () => {
  try { const schedule = await window.portabase.installSchedule(6); result(`Automatic backup installed for this ${schedule.platform} computer. Portabase will run every ${schedule.everyHours} hours using protected local credentials.`); }
  catch (error) { result(error.message, true); }
});
$('removeSchedule').addEventListener('click', async () => {
  try { await window.portabase.removeSchedule(); result('The automatic Portabase schedule was removed. Existing recovery capsules were not deleted.'); }
  catch (error) { result(error.message, true); }
});
$('dryRun').addEventListener('click', () => run('restore', ['--capsule', $('capsule').value, '--preflight'], targetValues()));
$('drillRestore').addEventListener('click', async () => {
  const target = $('targetRef').value.trim();
  if (!target || $('typedRef').value.trim() !== target) return result('Restore drill refused: type the exact NEW project reference in the write guard.', true);
  if (!confirm('Write the deliberately limited trial sample into this disposable project? This is validation, not a complete recovery.')) return;
  await run('restore', ['--capsule', $('capsule').value, '--drill', '--confirm-target', target], targetValues());
});
$('executeRestore').addEventListener('click', async () => {
  const target = $('targetRef').value.trim();
  if (!target || $('typedRef').value.trim() !== target) return result('Restore refused: the typed confirmation must exactly match the NEW project reference.', true);
  await run('restore', ['--capsule', $('capsule').value, '--execute', '--confirm-target', target], targetValues());
});

/* ---- Boot ---- */
window.portabase.state().then(state => {
  $('security').textContent = state.secureStorage ? '● OS-protected secret storage available' : '● Secure secret storage unavailable; values will not be persisted';
  $('security').classList.toggle('warn', !state.secureStorage);
  $('licenseStatus').textContent = 'Community edition · full open-source capture · no license required';
  if (state.config) { $('projectRef').value = state.config.projectRef || ''; $('destination').value = state.config.provider?.path || ''; }
  show(state.comfortLevel ? HOME_PAGE[state.comfortLevel] : 'comfort');
}).catch(error => result(error.message, true));
