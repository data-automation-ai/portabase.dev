const $ = id => document.getElementById(id);
const sessionKey = `portabase-private-session:${location.port}`;
const suppliedToken = new URLSearchParams(location.hash.slice(1)).get('t') || '';
if (suppliedToken) sessionStorage.setItem(sessionKey, suppliedToken);
const token = suppliedToken || sessionStorage.getItem(sessionKey) || '';
history.replaceState(null, '', location.pathname);

let inventory = null, bootstrap = null, csrf = '', busy = false, savedIntent = null;
const sourceFieldIds = ['sourceDatabasePassword', 'sourceServiceRoleKey', 'sourceAccessToken', 'capsulePassphrase'];
const selected = { tables: new Set(), buckets: new Set() };
const size = value => {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  return `${(bytes / 1024 ** 4).toFixed(2)} TiB`;
};
const number = value => new Intl.NumberFormat().format(Number(value) || 0);
const messages = {
  session_required: 'Session expired. Reopen the private link printed by your runner.',
  inventory_unavailable: 'The runner could not read a complete database and Storage inventory. Check the private source connection.',
  inventory_changed: 'This inventory is no longer current. Probe the source again before saving.',
  empty_selection_confirmation_required: 'Confirm that you intend to omit all table rows and bucket files.',
  invalid_selection: 'The selection is invalid. Probe again and choose from the current inventory.',
  private_scratch_unavailable: 'The runner could not inspect its configured scratch volume.',
  incomplete_target_configuration: 'Enter the target project reference, database password, and secret key together.',
  invalid_runtime_secrets: 'The connection update was refused. Check the supplied fields.',
  invalid_source_database_password: 'Enter the database password for the protected project.',
  invalid_source_service_key: 'The project secret key is missing or invalid.',
  invalid_source_access_token: 'The source management token is invalid.',
  invalid_capsule_passphrase: 'Use a capsule passphrase of at least 16 characters.',
  invalid_target_project: 'Use a different, valid 20 character target project ref.',
  invalid_target_service_key: 'The target service role key is missing or invalid.',
  invalid_target_database_password: 'Enter the database password for the blank recovery project.',
};
const SOURCE_START = [
  'Open https://supabase.com/dashboard in a new browser tab.',
  'Sign in with the email, Google, or GitHub account used when the project was created or shared with you.',
  'Choose the organization that owns the project, then open the project you want PortaBase to protect.',
  'If no organization or project appears, ask its owner to invite your email address. Do not create a new project as a substitute for the source.',
];
const TARGET_START = [
  'Open https://supabase.com/dashboard and sign in.',
  'Choose the organization that should own the recovery project.',
  'Open the blank recovery project. If one does not exist, use New project, choose that organization, create a separate project, and wait until setup finishes.',
  'Keep the source and recovery target open in separate tabs so their values are not mixed up.',
];
const HELP_TOPICS = {
  'source-database-password': {
    title: 'Source database password',
    intro: 'The runner combines this password with its bound project reference to connect to hosted Supabase PostgreSQL.',
    steps: [...SOURCE_START, 'Use the database password selected when the source project was created.', 'If you do not know it, ask the project owner. A project owner can reset it from Project Settings, Database.', 'Enter only the password. The runner constructs the hosted database endpoint for you.'],
    note: 'Resetting a database password can interrupt other applications until their saved connection credentials are updated. This password stays inside the runner.',
    url: 'https://supabase.com/docs/guides/database/connecting-to-postgres',
  },
  'source-key': {
    title: 'Project secret key',
    intro: 'The runner uses the current project secret key to read Auth and Storage for backup.',
    steps: [...SOURCE_START, 'In the source project, open Settings, then API Keys.', 'Reveal and copy a Secret key beginning with sb_secret_.', 'Paste it here. You do not need a legacy JWT.', 'Do not use the anon or publishable key.'],
    note: 'The secret key has elevated access. This form sends it only to the private runner and clears the field after saving.',
    url: 'https://supabase.com/docs/guides/getting-started/api-keys',
  },
  'source-token': {
    title: 'Management access token',
    intro: 'The runner uses this token to discover and download every Edge Function in the protected project.',
    steps: ['Open https://supabase.com/dashboard and sign in with the account that can access the source project.', 'Open your account menu, then Access Tokens.', 'Create a scoped personal access token.', 'Limit it to the source project and allow read access for the database connection settings and Edge Functions.', 'Copy the token when Supabase displays it and paste it here.'],
    note: 'The token stays inside the runner. PortaBase uses it automatically for Edge Functions; there is no separate Edge Functions switch.',
    url: 'https://supabase.com/docs/guides/platform/personal-access-tokens',
  },
  'capsule-passphrase': {
    title: 'Capsule passphrase',
    intro: 'You create this value. It does not come from Supabase.',
    steps: ['Use a password manager to generate a long, unique passphrase of at least 16 characters.', 'Save a recovery copy outside this runner.', 'Paste it here. The runner uses it to encrypt and authenticate capsules.'],
    note: 'PortaBase cannot recover this passphrase. Losing every copy can make your capsules permanently unreadable.',
    url: 'https://portabase.dev/security#keys-protected',
    linkLabel: 'Open PortaBase key protection guide',
  },
  'target-ref': {
    title: 'Recovery target project ref',
    intro: 'This is the 20-character identifier for the blank Supabase project that will receive a recovery.',
    steps: [...TARGET_START, 'In the blank target project, open Settings, then General.', 'Find Reference ID under Project Settings.', 'Copy the 20-character value and paste it here.'],
    note: 'The target reference must be different from the protected source project. Never restore into the source.',
    url: 'https://supabase.com/docs/guides/graphql',
  },
  'target-database-password': {
    title: 'Recovery target database password',
    intro: 'The runner combines this password with the target project reference to restore PostgreSQL data into the blank project.',
    steps: [...TARGET_START, 'Use the database password selected when the blank target was created.', 'If you do not know it, a project owner can set a new password from Project Settings, Database.', 'Enter only the password. The runner constructs the hosted target database endpoint.'],
    note: 'This must be the blank target password. PortaBase checks that the target reference differs from the protected source before replay.',
    url: 'https://supabase.com/docs/guides/database/connecting-to-postgres',
  },
  'target-key': {
    title: 'Recovery target secret key',
    intro: 'The runner uses a server-side target key to recreate and verify Storage objects during recovery.',
    steps: [...TARGET_START, 'In the target project, open Settings, then API Keys.', 'Copy a Secret key beginning with sb_secret_, or the legacy service_role key if that is what the project provides.', 'Paste it here and confirm it belongs to the target project.'],
    note: 'Never enter the source key in this field. This elevated key stays inside the private runner.',
    url: 'https://supabase.com/docs/guides/getting-started/api-keys',
  },
};
let activeHelpKey = null, helpSuppressedUntil = 0;
function showError(message) { $('error').textContent = message; $('error').hidden = false; $('error').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
function clearError() { $('error').hidden = true; }
async function api(path, options = {}) {
  const response = await fetch(path, { redirect: 'error', ...options, headers: { 'X-Portabase-Session': token, ...(options.headers || {}) } });
  let body = {}; try { body = await response.json(); } catch { /* fixed fallback */ }
  if (response.status === 401) sessionStorage.removeItem(sessionKey);
  if (!response.ok) throw new Error(messages[body.error] || 'The private runner could not complete that request.');
  return body;
}
function setStatus(id, ready, readyText, missingText) {
  const node = $(id); node.textContent = ready ? readyText : missingText; node.closest('li')?.classList.toggle('ready', ready);
}
function setRunnerMode(mode) {
  for (const value of ['setup-pending', 'setup-connected', 'setup-ready']) document.body.classList.remove(value);
  document.body.classList.add(mode);
}
function renderConnections(value = {}) {
  const ready = value.sourceConfigured && value.passphraseConfigured;
  setRunnerMode(!ready ? 'setup-pending' : inventory ? 'setup-ready' : 'setup-connected');
  $('sourceConnectionsForm').hidden = ready;
  $('sourceConfiguredPanel').hidden = !ready;
  $('page-title').textContent = !ready ? 'Connect your Supabase project' : inventory ? 'Your recovery runner' : 'Your Supabase access is saved';
  document.querySelector('.hero .intro').textContent = !ready
    ? 'Enter four values. The runner will privately inspect and protect your Database, Auth, Storage, and Edge Functions.'
    : inventory ? 'Review what the runner discovered and choose what enters the encrypted capsule.'
      : 'You will not need to enter those four values again. Inspect the project when you are ready.';
  const savedTime = value.updatedAt ? new Date(value.updatedAt).toLocaleString() : null;
  $('sourceSavedMessage').textContent = `Stored inside this runner${savedTime ? ` on ${savedTime}` : ''}. You will not need to enter them again.`;
  $('connectionMessage').textContent = ready
    ? `All four values saved securely${savedTime ? ` · ${savedTime}` : ''}.`
    : 'Enter the four values, then connect.';
  setStatus('sourceStatus', value.sourceConfigured, 'Credentials stored', 'Needs configuration');
  setStatus('capsuleStatus', value.passphraseConfigured, 'Passphrase stored', 'Passphrase required');
  setStatus('targetStatus', value.targetConfigured, value.targetRef ? `Target ${value.targetRef}` : 'Target stored', 'Configure when restoring');
}
function renderEvents(state = {}) {
  $('localStateStatus').textContent = state.persistent ? 'SQLite persistent' : 'Unavailable';
  const list = $('events'); list.replaceChildren();
  if (!state.events?.length) { const item = document.createElement('li'); item.textContent = 'No local events yet'; list.append(item); return; }
  for (const event of state.events) {
    const item = document.createElement('li'), title = document.createElement('strong'), time = document.createElement('time'), detail = document.createElement('span');
    title.textContent = event.eventType.replaceAll('.', ' '); time.dateTime = event.occurredAt; time.textContent = new Date(event.occurredAt).toLocaleString();
    const parts = [];
    if (event.detail?.tableCount != null) parts.push(`${number(event.detail.tableCount)} tables`);
    if (event.detail?.bucketCount != null) parts.push(`${number(event.detail.bucketCount)} buckets`);
    if (event.detail?.objectCount != null) parts.push(`${number(event.detail.objectCount)} objects`);
    if (event.detail?.selectedBytes != null) parts.push(size(event.detail.selectedBytes));
    detail.textContent = parts.join(' · ') || event.state; item.append(title, time, detail); list.append(item);
  }
}
function selectedBytes() {
  if (!inventory) return 0;
  return ['tables', 'buckets'].reduce((total, kind) => total + inventory[kind].filter(row => selected[kind].has(row.key)).reduce((sum, row) => sum + row.bytes, 0), 0);
}
function renderCapacity() {
  const scratch = inventory?.scratch || bootstrap?.scratch, chosen = selectedBytes();
  $('selectedSize').textContent = inventory ? size(chosen) : '—';
  if (!scratch) return;
  $('runtimeStatus').textContent = `${scratch.runtimePlatform}/${scratch.runtimeArchitecture}`;
  if (!scratch.authoritative) {
    $('runnerStorageAvailable').textContent = 'Linux runner not connected';
    $('runnerStorageNeeded').textContent = 'Storage will be measured inside the runner, never from this computer.';
    $('runnerStorageBar').style.width = '0'; $('runnerStorageMeter').setAttribute('aria-valuenow', '0');
    $('requiredSize').textContent = inventory ? size(Math.ceil(chosen * scratch.planningMultiplier + scratch.fixedReserveBytes)) : 'Select data';
    $('freeSize').textContent = 'Linux runner only';
    $('scratchStatus').textContent = 'Checked automatically';
    $('scratchStatus').closest('li')?.classList.remove('ready');
    $('capacityBar').style.width = '0';
    $('capacityBar').parentElement.setAttribute('aria-valuenow', '0');
    $('capacityBadge').className = 'status-chip bad';
    $('capacityBadge').textContent = 'Not runner capacity';
    $('capacityDetail').textContent = 'This interface is running on a development host. Scratch capacity is reported only by the internal Linux runner that will execute the job.';
    return;
  }
  const required = inventory ? Math.ceil(chosen * scratch.planningMultiplier + scratch.fixedReserveBytes) : null;
  const freePercent = Math.max(0, Math.min(100, Math.round(scratch.freeBytes / scratch.totalBytes * 100)));
  $('runnerStorageAvailable').textContent = `${size(scratch.freeBytes)} available · ${freePercent}% free`;
  $('runnerStorageNeeded').textContent = required == null ? `${size(scratch.totalBytes)} total working storage.` : `About ${size(required)} planned for this selection.`;
  $('runnerStorageBar').style.width = `${freePercent}%`; $('runnerStorageMeter').setAttribute('aria-valuenow', String(freePercent));
  $('requiredSize').textContent = required == null ? 'Select data' : size(required); $('freeSize').textContent = size(scratch.freeBytes);
  $('scratchStatus').textContent = `${size(scratch.freeBytes)} free`; $('scratchStatus').closest('li')?.classList.add('ready');
  const ratio = required == null ? 0 : Math.min(100, Math.round(required / scratch.freeBytes * 100));
  $('capacityBar').style.width = `${ratio}%`; $('capacityBar').parentElement.setAttribute('aria-valuenow', String(ratio));
  const enough = required != null && scratch.freeBytes >= required, badge = $('capacityBadge');
  badge.className = `status-chip ${required == null ? 'neutral' : enough ? 'good' : 'bad'}`;
  badge.textContent = required == null ? 'Waiting' : enough ? 'Capacity available' : 'More scratch required';
  $('capacityDetail').textContent = required == null ? `The runner reports ${size(scratch.totalBytes)} total scratch capacity.`
    : enough ? `${size(scratch.freeBytes - required)} remains above the planning reserve. This is an estimate, not a guaranteed final size.`
      : `Add at least ${size(required - scratch.freeBytes)} before running this selection. The current engine stages the full capture.`;
}
function matches(row, kind) {
  const keyword = $('keyword').value.trim().toLocaleLowerCase();
  return (!keyword || row.key.toLocaleLowerCase().includes(keyword)) && (kind !== 'tables' || !$('schema').value || row.schema === $('schema').value);
}
function renderChoices(kind) {
  const parent = $(kind); parent.replaceChildren();
  if (!inventory) { parent.textContent = 'Run a source probe to load this inventory.'; return; }
  const rows = inventory[kind].filter(row => matches(row, kind));
  if (!rows.length) { parent.textContent = 'No items match the current filters.'; return; }
  for (const row of rows) {
    const label = document.createElement('label'), checkbox = document.createElement('input'), name = document.createElement('code'), count = document.createElement('span'), bytes = document.createElement('span');
    label.className = `choice ${kind === 'tables' ? 'table-columns' : 'bucket-columns'}`; checkbox.type = 'checkbox'; checkbox.checked = selected[kind].has(row.key); checkbox.disabled = row.selectable === false;
    checkbox.setAttribute('aria-label', `Include ${kind === 'tables' ? 'table' : 'bucket'} ${row.key}`);
    checkbox.addEventListener('change', () => { if (checkbox.checked) selected[kind].add(row.key); else selected[kind].delete(row.key); updateSummary(); });
    name.textContent = row.key; count.textContent = number(kind === 'tables' ? row.rows : row.objectCount); bytes.textContent = size(row.bytes);
    label.append(checkbox, name, count, bytes); parent.append(label);
  }
}
function renderFilters() {
  renderChoices('tables'); renderChoices('buckets');
  if (!inventory) { $('visibleCount').textContent = 'No inventory'; return; }
  $('visibleCount').textContent = `${number(inventory.tables.filter(row => matches(row, 'tables')).length)} tables · ${number(inventory.buckets.filter(row => matches(row, 'buckets')).length)} buckets visible`;
}
function updateSummary() {
  const ready = Boolean(inventory) && !busy;
  $('save').disabled = !ready || (!selected.tables.size && !selected.buckets.size && !$('empty').checked); $('refresh').disabled = busy;
  if (inventory) $('summary').textContent = `${number(selected.tables.size)} tables · ${number(selected.buckets.size)} buckets · ${size(selectedBytes())} estimated source data`;
  renderCapacity();
}
function renderInventory() {
  const schemas = [...new Set(inventory.tables.map(row => row.schema))].sort((a, b) => a.localeCompare(b));
  $('schema').replaceChildren(new Option('All schemas', ''), ...schemas.map(value => new Option(value, value)));
  $('tableCount').textContent = number(inventory.tables.length); $('estimatedRows').textContent = number(inventory.overview.estimatedRows);
  $('databaseSize').textContent = `${size(inventory.overview.databaseBytes)} database`; $('bucketCount').textContent = number(inventory.buckets.length);
  $('objectCount').textContent = number(inventory.overview.objectCount); $('storageSize').textContent = `${size(inventory.overview.objectBytes)} stored`;
  $('functionCount').textContent = inventory.overview.functionCount == null ? '—' : number(inventory.overview.functionCount);
  renderFilters(); updateSummary(); renderEvents(inventory.state);
}
async function loadBootstrap() {
  clearError();
  try {
    bootstrap = await api('/api/bootstrap'); csrf = bootstrap.csrf; $('project').textContent = bootstrap.projectRef; $('runner').textContent = bootstrap.runnerId;
    renderConnections(bootstrap.connections); renderEvents(bootstrap.state); renderCapacity();
  } catch (failure) { showError(failure.message); }
}
function setProbeStage(id, state, detail) {
  const item = $(id), note = item.querySelector('small');
  item.className = state;
  note.textContent = detail;
}
function resetInspection({ accessReady = false } = {}) {
  $('inspection-title').textContent = accessReady ? 'Inspecting your project' : 'Connecting to Supabase';
  $('inspectionStatus').textContent = accessReady ? 'The runner is checking your project now.' : 'Saving your four values inside the runner…';
  setProbeStage('probeAccess', accessReady ? 'done' : 'active', accessReady ? 'Saved in runner' : 'Saving…');
  for (const id of ['probeDatabase', 'probeStorage', 'probeFunctions']) setProbeStage(id, '', 'Waiting');
  $('probeTablePreview').hidden = true; $('probeTableList').replaceChildren();
  $('viewInventory').hidden = true; $('closeInspection').hidden = true;
}
function showInspection(options) {
  resetInspection(options);
  if (!$('inspectionProgress').open) $('inspectionProgress').showModal();
}
function probeFailed(message) {
  $('inspection-title').textContent = 'Connection needs attention';
  $('inspectionStatus').textContent = message;
  $('closeInspection').hidden = false;
}
function inspectionFailureMessage() {
  if ($('probeDatabase').classList.contains('bad')) return 'The database did not accept the connection. Your four values remain saved; use Change saved values if the database password needs correction.';
  if ($('probeStorage').classList.contains('bad')) return 'The database connected, but the runner could not read Storage. Your four values remain saved.';
  if ($('probeFunctions').classList.contains('bad')) return 'The database and Storage connected, but the runner could not read Edge Functions with the management token. Your four values remain saved.';
  return 'The inspection did not finish. Your four values remain saved, so you can retry without entering them again.';
}
function renderProbeTables(tables = []) {
  $('probeTablePreview').hidden = false;
  $('probeTableCount').textContent = `${number(tables.length)} database table${tables.length === 1 ? '' : 's'} found`;
  const list = $('probeTableList'); list.replaceChildren();
  for (const table of tables.slice(0, 8)) {
    const name = document.createElement('span'); name.textContent = table.key; list.append(name);
  }
  if (tables.length > 8) {
    const more = document.createElement('span'); more.textContent = `+ ${number(tables.length - 8)} more`; more.className = 'more'; list.append(more);
  }
}
async function streamInspection() {
  const response = await fetch('/api/setup-stream', { redirect: 'error', headers: { 'X-Portabase-Session': token } });
  if (response.status === 401) sessionStorage.removeItem(sessionKey);
  if (!response.ok || !response.body) throw new Error('The private runner could not begin the inspection.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', completed = null;
  const accept = event => {
    if (event.type === 'database') {
      setProbeStage('probeDatabase', event.ok ? 'done' : 'bad', event.ok ? `${number(event.tables.length)} tables found` : 'Could not connect');
      if (event.ok) {
        $('inspection-title').textContent = 'Connected';
        $('inspectionStatus').textContent = 'Your values are locked inside the runner. Inventory is now underway.';
        renderProbeTables(event.tables);
      }
    } else if (event.type === 'storage') {
      setProbeStage('probeStorage', event.ok ? 'done' : 'bad', event.ok ? `${number(event.buckets.length)} buckets found` : 'Could not read');
    } else if (event.type === 'functions') {
      setProbeStage('probeFunctions', event.ok ? 'done' : 'bad', event.ok ? `${number(event.functionCount)} found` : 'Could not read');
    } else if (event.type === 'complete') completed = event.inventory;
    else if (event.type === 'error') throw new Error(messages[event.error] || 'The inspection did not finish.');
  };
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n'); buffer = lines.pop() || '';
    for (const line of lines) if (line.trim()) accept(JSON.parse(line));
    if (done) break;
  }
  if (buffer.trim()) accept(JSON.parse(buffer));
  if (!completed) throw new Error('The inspection ended before the inventory was ready.');
  return completed;
}
async function inspect({ keepModal = false } = {}) {
  busy = true; inventory = null; savedIntent = null; $('saved').hidden = true; clearError(); $('empty').checked = false;
  if (!keepModal) showInspection({ accessReady: true });
  setProbeStage('probeAccess', 'done', 'Saved in runner');
  setProbeStage('probeDatabase', 'active', 'Connecting…');
  $('tables').textContent = 'Reading database catalog…'; $('buckets').textContent = 'Enumerating Storage objects…'; $('summary').textContent = 'Reading source inventory…'; updateSummary();
  try {
    inventory = await streamInspection(); csrf = inventory.csrf; selected.tables = new Set(inventory.tables.filter(row => row.selectable).map(row => row.key)); selected.buckets = new Set(inventory.buckets.map(row => row.key));
    $('loaded').textContent = `Read only probe completed ${new Date(inventory.generatedAt).toLocaleString()}.`; renderInventory();
    renderConnections(bootstrap.connections);
    $('inspection-title').textContent = 'Inventory ready';
    $('inspectionStatus').textContent = `${number(inventory.tables.length)} tables and ${number(inventory.buckets.length)} Storage buckets are ready to review.`;
    $('viewInventory').hidden = false;
    return true;
  } catch (failure) {
    const diagnosis = inspectionFailureMessage();
    showError(diagnosis); $('summary').textContent = diagnosis; renderFilters();
    renderConnections(bootstrap?.connections || {});
    probeFailed(diagnosis);
    return false;
  } finally { busy = false; updateSummary(); }
}
async function saveConnections({ fields, buttonId, messageId, requireFields = [] }) {
  clearError();
  const body = Object.fromEntries(fields.map(id => [id, $(id).value]).filter(([, value]) => value !== ''));
  const missing = requireFields.filter(id => !body[id]);
  if (missing.length) { showError('Complete the required fields before connecting.'); return false; }
  if (!Object.keys(body).length) { showError('Enter at least one value to update.'); return false; }
  $(buttonId).disabled = true; $(messageId).textContent = 'Saving inside runner…';
  try {
    const result = await api('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Portabase-CSRF': csrf }, body: JSON.stringify(body) });
    for (const id of fields) $(id).value = '';
    bootstrap = await api('/api/bootstrap'); csrf = bootstrap.csrf; renderEvents(bootstrap.state);
    renderConnections(result.connections); $(messageId).textContent = 'Saved securely inside this runner.';
    return true;
  } catch (failure) { showError(failure.message); $(messageId).textContent = 'Connection update was not saved.'; return false; }
  finally { $(buttonId).disabled = false; }
}
$('sourceConnectionsForm').addEventListener('submit', async event => {
  event.preventDefault();
  showInspection({ accessReady: false });
  const fields = sourceFieldIds;
  const required = [];
  if (!bootstrap?.connections?.sourceConfigured) required.push('sourceDatabasePassword', 'sourceServiceRoleKey', 'sourceAccessToken');
  if (!bootstrap?.connections?.passphraseConfigured) required.push('capsulePassphrase');
  const saved = await saveConnections({ fields, requireFields: required, buttonId: 'saveSourceConnections', messageId: 'connectionMessage' });
  if (!saved) return probeFailed('The values were not saved. Correct the highlighted setup information and try Connect again.');
  setProbeStage('probeAccess', 'done', 'Saved in runner');
  $('inspectionStatus').textContent = 'Values saved. Validating the Supabase connection…';
  await inspect({ keepModal: true });
});
$('maskValues').addEventListener('change', event => {
  const type = event.currentTarget.checked ? 'password' : 'text';
  for (const id of sourceFieldIds) $(id).type = type;
});
$('inspectSavedSource').addEventListener('click', async event => {
  event.currentTarget.disabled = true; event.currentTarget.textContent = 'Inspecting project…';
  const ok = await inspect();
  event.currentTarget.disabled = false; event.currentTarget.textContent = ok ? 'Inspect again' : 'Try inspection again';
});
$('editSourceConnections').addEventListener('click', () => {
  $('sourceConfiguredPanel').hidden = true; $('sourceConnectionsForm').hidden = false;
  $('connectionMessage').textContent = 'Saved values remain in the runner. Enter only the values you want to replace.';
});
$('targetConnectionsForm').addEventListener('submit', async event => {
  event.preventDefault();
  const fields = ['targetRef', 'targetDatabasePassword', 'targetServiceRoleKey'];
  await saveConnections({ fields, requireFields: fields,
    buttonId: 'saveTargetConnections', messageId: 'targetConnectionMessage' });
});
$('refresh').addEventListener('click', () => inspect()); $('keyword').addEventListener('input', renderFilters); $('schema').addEventListener('change', renderFilters); $('empty').addEventListener('change', updateSummary);
$('selectVisible').addEventListener('click', () => { if (!inventory) return; for (const kind of ['tables', 'buckets']) for (const row of inventory[kind]) if (matches(row, kind) && row.selectable !== false) selected[kind].add(row.key); renderFilters(); updateSummary(); });
$('clearVisible').addEventListener('click', () => { if (!inventory) return; for (const kind of ['tables', 'buckets']) for (const row of inventory[kind]) if (matches(row, kind)) selected[kind].delete(row.key); renderFilters(); updateSummary(); });
$('save').addEventListener('click', async () => {
  if (busy || !inventory || $('save').disabled) return; busy = true; clearError(); updateSummary();
  try {
    const body = await api('/api/configurations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Portabase-CSRF': csrf }, body: JSON.stringify({ inventoryRevision: inventory.inventoryRevision, selectedTables: [...selected.tables], selectedBuckets: [...selected.buckets], incrementalBinary: $('incremental').checked, confirmEmpty: $('empty').checked }) });
    savedIntent = body.intent; $('intent').textContent = JSON.stringify(savedIntent, null, 2); $('saved').hidden = false; $('loaded').textContent = 'Selection saved privately. Probe again to create another revision.';
    bootstrap = await api('/api/bootstrap'); csrf = bootstrap.csrf; renderEvents(bootstrap.state); $('saved').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (failure) { showError(failure.message); }
  finally { busy = false; inventory = null; updateSummary(); }
});
$('download').addEventListener('click', () => {
  if (!savedIntent) return; const url = URL.createObjectURL(new Blob([`${JSON.stringify(savedIntent, null, 2)}\n`], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'portabase-job-reference.json'; link.click(); URL.revokeObjectURL(url);
});
$('openSealInfo').addEventListener('click', () => $('sealInfo').showModal());
$('closeSealInfo').addEventListener('click', () => $('sealInfo').close());
$('sealInfo').addEventListener('click', event => { if (event.target === $('sealInfo')) $('sealInfo').close(); });
$('openTechnicalInfo').addEventListener('click', () => { $('sealInfo').close(); $('technicalInfo').showModal(); });
$('closeTechnicalInfo').addEventListener('click', () => $('technicalInfo').close());
$('backToSealInfo').addEventListener('click', () => { $('technicalInfo').close(); $('sealInfo').showModal(); });
$('technicalInfo').addEventListener('click', event => { if (event.target === $('technicalInfo')) $('technicalInfo').close(); });

function showHelpPrompt(field) {
  if (Date.now() < helpSuppressedUntil || !HELP_TOPICS[field.dataset.help]
    || $('sealInfo').open || $('helpPrompt').open || $('helpDetail').open) return;
  activeHelpKey = field.dataset.help;
  $('helpTopicName').textContent = HELP_TOPICS[activeHelpKey].title;
  $('helpPrompt').showModal();
}
function openHelpDetail() {
  const topic = HELP_TOPICS[activeHelpKey];
  if (!topic) return;
  $('helpPrompt').close();
  $('help-detail-title').textContent = topic.title;
  $('help-detail-intro').textContent = topic.intro;
  const steps = $('help-detail-steps'); steps.replaceChildren();
  for (const value of topic.steps) { const item = document.createElement('li'); item.textContent = value; steps.append(item); }
  $('help-detail-note').textContent = topic.note;
  $('help-detail-link').href = topic.url;
  $('help-detail-link').textContent = topic.linkLabel || 'Open official Supabase guide';
  helpSuppressedUntil = Date.now() + 1000;
  $('helpDetail').showModal();
}
for (const field of document.querySelectorAll('[data-help]')) {
  field.addEventListener('dblclick', () => showHelpPrompt(field));
}
$('acceptHelp').addEventListener('click', openHelpDetail);
$('declineHelp').addEventListener('click', () => { helpSuppressedUntil = Date.now() + 1000; $('helpPrompt').close(); });
$('closeHelpDetail').addEventListener('click', () => { helpSuppressedUntil = Date.now() + 1000; $('helpDetail').close(); });
$('helpPrompt').addEventListener('click', event => { if (event.target === $('helpPrompt')) $('helpPrompt').close(); });
$('helpDetail').addEventListener('click', event => { if (event.target === $('helpDetail')) $('helpDetail').close(); });
$('closeInspection').addEventListener('click', () => $('inspectionProgress').close());
$('viewInventory').addEventListener('click', () => { $('inspectionProgress').close(); $('inventory-heading').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
loadBootstrap();
