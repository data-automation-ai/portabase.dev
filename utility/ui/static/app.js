// Portabase local UI. Talks to the portabase process that served it, and nothing else.
// All values are rendered as text nodes; nothing from the API is parsed as HTML.

const token = new URLSearchParams(location.hash.slice(1)).get('t') || sessionToken();
history.replaceState(null, '', location.pathname);

function sessionToken() {
  try { return sessionStorage.getItem('portabase-ui-session'); } catch { return null; }
}
try { if (token) sessionStorage.setItem('portabase-ui-session', token); } catch { /* optional */ }

const $ = (id) => document.getElementById(id);

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === 'class') node.className = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function bytes(value) {
  const n = Number(value) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}
const num = (value) => (Number(value) || 0).toLocaleString();

let snapshot = null;

async function load(refresh = false) {
  $('refresh').disabled = true;
  $('refresh').textContent = refresh ? 'Refreshing…' : 'Loading…';
  try {
    const response = await fetch(`/api/snapshot${refresh ? '?refresh=1' : ''}`, { headers: { 'X-Portabase-Session': token || '' } });
    $('csp').textContent = response.headers.get('content-security-policy') || '(header missing)';
    const body = await response.json();
    if (!response.ok) throw new Error(response.status === 401 ? 'Session expired. Use the link printed by `portabase ui`.' : body.error);
    snapshot = body;
    $('error').hidden = true;
    render();
  } catch (error) {
    $('error').textContent = error.message;
    $('error').hidden = false;
  } finally {
    $('refresh').disabled = false;
    $('refresh').textContent = 'Refresh';
  }
}

function render() {
  const s = snapshot;
  $('project').textContent = s.project.ref;
  $('destination').textContent = `→ ${s.project.destination}`;
  $('edition').hidden = s.project.edition !== 'trial';
  $('generated').textContent = `Read ${new Date(s.generatedAt).toLocaleTimeString()}`;
  $('origin').textContent = location.origin;
  $('port').textContent = location.port;
  renderTiles(s);
  renderChecklist(s.checklist);
  renderDatabase();
  renderStorage(s.storage);
  renderFunctions(s.functions);
  renderReadiness(s.readiness);
}

function tile(label, value, sub) {
  return h('div', { class: 'tile' }, h('span', { class: 'label' }, label), h('span', { class: 'value' }, value), sub ? h('span', { class: 'sub' }, sub) : null);
}

function renderTiles(s) {
  const db = s.database.ok ? s.database.data : null;
  const st = s.storage.ok ? s.storage.data : null;
  const appTables = db ? db.tables.filter(t => !t.platform) : [];
  const counts = s.checklist.counts;
  $('tiles').replaceChildren(
    tile('Database', db ? bytes(db.databaseBytes) : '—', db ? `Postgres ${db.serverVersion.split(' ')[0]}` : s.database.error),
    tile('App tables', db ? num(appTables.length) : '—', db ? `≈ ${num(appTables.reduce((t, x) => t + Number(x.rows), 0))} rows` : null),
    tile('Auth users', db ? num(db.authUsers) : '—', db ? `${num(db.policies)} RLS policies` : null),
    tile('Storage', st ? bytes(st.totalBytes) : '—', st ? `${num(st.objectCount)} objects · ${st.buckets.length} buckets` : s.storage.error),
    tile('Edge Functions', s.functions.ok ? num(s.functions.data.length) : '—', s.functions.ok ? null : s.functions.error),
    tile('Checklist', `${counts.KEEP || 0} in`, [counts.BLOCKED ? `${counts.BLOCKED} blocked` : null, counts.SKIP ? `${counts.SKIP} skipped` : null].filter(Boolean).join(' · ') || 'nothing blocked'),
  );
}

const STATUS_TEXT = {
  KEEP: 'In capsule', PARTIAL: 'Partly', SKIP: 'Skipped', BLOCKED: 'Blocked', NEVER: 'Never captured',
};
const LAYER_TEXT = {
  database: 'Database', storage: 'Storage', functions: 'Edge Functions', auth: 'Auth', capsule: 'Encryption & destination', never: 'Never in any capsule',
};

function renderChecklist(checklist) {
  $('legend').replaceChildren(...Object.entries(STATUS_TEXT).map(([key, text]) => h('span', { class: `chip ${key.toLowerCase()}` }, `${text} ${checklist.counts[key] || 0}`)));
  const groups = new Map();
  for (const entry of checklist.items) {
    if (!groups.has(entry.layer)) groups.set(entry.layer, []);
    groups.get(entry.layer).push(entry);
  }
  $('checklist').replaceChildren(...[...groups].map(([layer, entries]) => h('div', { class: 'group' },
    h('h3', {}, LAYER_TEXT[layer] || layer),
    h('ul', { class: 'items' }, entries.map(entry => h('li', {},
      h('span', { class: `chip ${entry.status.toLowerCase()}` }, STATUS_TEXT[entry.status]),
      h('span', { class: 'name' }, entry.name),
      entry.bytes ? h('span', { class: 'size' }, bytes(entry.bytes)) : h('span', { class: 'size' }),
      h('span', { class: 'detail' }, entry.detail),
    ))),
  )));
}

let sortKey = 'bytes';
let sortDir = -1;

function renderDatabase() {
  const db = snapshot.database;
  if (!db.ok) {
    $('schemas').replaceChildren(h('p', { class: 'banner' }, db.error));
    $('tables').replaceChildren();
    return;
  }
  const filter = $('table-filter').value.trim().toLowerCase();
  const showPlatform = $('show-platform').checked;
  const bySchema = new Map();
  for (const t of db.data.tables) {
    const row = bySchema.get(t.schema) || { tables: 0, bytes: 0, platform: t.platform };
    row.tables += 1; row.bytes += Number(t.bytes);
    bySchema.set(t.schema, row);
  }
  $('schemas').replaceChildren(h('div', { class: 'schemas' }, [...bySchema].sort((a, b) => b[1].bytes - a[1].bytes)
    .filter(([, row]) => showPlatform || !row.platform)
    .map(([name, row]) => h('span', { class: 'schema' }, h('strong', {}, name), ` ${row.tables} tables · ${bytes(row.bytes)}`))));

  const rows = db.data.tables
    .filter(t => showPlatform || !t.platform)
    .filter(t => !filter || `${t.schema}.${t.name}`.toLowerCase().includes(filter))
    .sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      return (typeof av === 'string' ? av.localeCompare(bv) : Number(av) - Number(bv)) * sortDir;
    });
  const columns = [['schema', 'Schema'], ['name', 'Table'], ['rows', 'Rows ≈'], ['tableBytes', 'Data'], ['indexBytes', 'Indexes'], ['bytes', 'Total'], ['rls', 'RLS'], ['capsule', 'In capsule']];
  const head = h('tr', {}, columns.map(([key, label]) => {
    const th = h('th', { scope: 'col', class: 'sortable', 'aria-sort': sortKey === key ? (sortDir < 0 ? 'descending' : 'ascending') : null }, label);
    th.addEventListener('click', () => { sortDir = sortKey === key ? -sortDir : -1; sortKey = key; renderDatabase(); });
    return th;
  }));
  const body = rows.map(t => h('tr', {},
    h('td', {}, t.schema), h('td', {}, t.name),
    h('td', { class: 'num' }, t.analyzed ? num(t.rows) : '—'),
    h('td', { class: 'num' }, bytes(t.tableBytes)), h('td', { class: 'num' }, bytes(t.indexBytes)), h('td', { class: 'num' }, bytes(t.bytes)),
    h('td', {}, t.schema === 'public' && !t.rls ? h('span', { class: 'chip blocked' }, 'off') : t.rls ? 'on' : 'off'),
    h('td', {}, t.capsule)));
  $('tables').replaceChildren(h('thead', {}, head), h('tbody', {}, body.length ? body : h('tr', {}, h('td', { colspan: columns.length, class: 'muted' }, 'No tables match.'))));
}

function renderStorage(storage) {
  if (!storage.ok) return $('buckets').replaceChildren(h('caption', { class: 'banner' }, storage.error));
  const head = h('tr', {}, ['Bucket', 'Visibility', 'Objects', 'Size', 'Upload limit'].map(label => h('th', { scope: 'col' }, label)));
  const body = [...storage.data.buckets].sort((a, b) => b.totalBytes - a.totalBytes).map(b => h('tr', {},
    h('td', {}, b.id), h('td', {}, b.public ? h('span', { class: 'chip skip' }, 'public') : 'private'),
    h('td', { class: 'num' }, num(b.objectCount)), h('td', { class: 'num' }, bytes(b.totalBytes)),
    h('td', { class: 'num' }, b.fileSizeLimit ? bytes(b.fileSizeLimit) : '—')));
  $('buckets').replaceChildren(h('thead', {}, head), h('tbody', {}, body.length ? body : h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'No buckets.'))));
}

function renderFunctions(functions) {
  if (!functions.ok) return $('functions').replaceChildren(h('caption', { class: 'banner' }, functions.error));
  const head = h('tr', {}, ['Function', 'Status', 'Version', 'JWT verification', 'Updated'].map(label => h('th', { scope: 'col' }, label)));
  const body = functions.data.map(fn => h('tr', {},
    h('td', {}, fn.slug || fn.name), h('td', {}, fn.status || '—'), h('td', { class: 'num' }, fn.version ?? '—'),
    h('td', {}, fn.verifyJwt ? 'on' : h('span', { class: 'chip skip' }, 'off')),
    h('td', {}, fn.updatedAt ? new Date(fn.updatedAt).toLocaleString() : '—')));
  $('functions').replaceChildren(h('thead', {}, head), h('tbody', {}, body.length ? body : h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'No functions deployed.'))));
}

function renderReadiness(readiness) {
  const env = readiness.env;
  const rows = [
    ['SUPABASE_DB_URL', env.SUPABASE_DB_URL], ['SUPABASE_URL', env.SUPABASE_URL],
    ['SUPABASE_SERVICE_ROLE_KEY', env.SUPABASE_SERVICE_ROLE_KEY], ['SUPABASE_ACCESS_TOKEN', env.SUPABASE_ACCESS_TOKEN],
    [`${env.passphraseEnv} (≥ 16 chars)`, env.passphrase],
    ...Object.entries(readiness.tools).map(([name, ok]) => [`${name} (tool)`, ok]),
  ];
  $('readiness').replaceChildren(h('ul', { class: 'items readiness' }, rows.map(([name, ok]) => h('li', {},
    h('span', { class: `chip ${ok ? 'keep' : 'blocked'}` }, ok ? 'set' : 'missing'), h('code', { class: 'name' }, name)))));
}

for (const tab of document.querySelectorAll('[role=tab]')) {
  tab.addEventListener('click', () => {
    for (const other of document.querySelectorAll('[role=tab]')) other.setAttribute('aria-selected', String(other === tab));
    for (const panel of document.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== tab.dataset.tab;
  });
}
$('refresh').addEventListener('click', () => load(true));
$('table-filter').addEventListener('input', () => snapshot && renderDatabase());
$('show-platform').addEventListener('change', () => snapshot && renderDatabase());

load();
