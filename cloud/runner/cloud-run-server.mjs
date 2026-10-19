import http from 'node:http';
import zlib from 'node:zlib';
import { URL } from 'node:url';
import {
  generatePkcePair,
  generateOAuthState,
  buildSupabaseAuthorizeUrl,
  exchangeSupabaseOAuthCode,
} from './supabase-oauth.mjs';
import { discoverSupabaseProjectsAndDatabases } from './supabase-discovery.mjs';
import {
  computeDatabaseScopeSummary,
  buildExportManifest,
} from './database-scope.mjs';

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const GCP_REGION = process.env.PORTABASE_GCP_REGION || 'us-central1';
const GCP_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'portabase-dev';

function parseCookie(header, name) {
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match[1]));
  } catch {
    return decodeURIComponent(match[1]);
  }
}

function serializeCookie(name, val, maxAge = 3600) {
  const enc = encodeURIComponent(typeof val === 'string' ? val : JSON.stringify(val));
  return `${name}=${enc}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function sendJson(res, status, data, req = null) {
  const body = JSON.stringify(data);
  const acceptEncoding = String(req?.headers?.['accept-encoding'] || '');
  const baseHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Supabase-Token',
  };
  if (body.length > 100 * 1024 && acceptEncoding.includes('gzip')) {
    const gz = zlib.gzipSync(Buffer.from(body, 'utf8'));
    res.writeHead(status, {
      ...baseHeaders,
      'Content-Encoding': 'gzip',
    });
    res.end(gz);
    return;
  }
  res.writeHead(status, baseHeaders);
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total <= 2 * 1024 * 1024) {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function renderRunnerInteriorHtml({ hasServerDefaultToken, oauthStatus, oauthError }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Portabase Google Cloud Runner — Interior OAuth &amp; Database Spreadsheet</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #04070a;
      --panel: #0d1117;
      --panel-alt: #161b22;
      --border: #30363d;
      --text: #f0f6fc;
      --muted: #8b949e;
      --accent: #3ecf8e;
      --blue: #58a6ff;
      --purple: #d2a8ff;
      --warn: #d29922;
      --danger: #f85149;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.45;
      border: 16px solid transparent;
      border-image: repeating-linear-gradient(
        -45deg,
        #facc15,
        #facc15 18px,
        #000000 18px,
        #000000 36px
      ) 16;
      min-height: 100vh;
    }
    .hazard-tape-header {
      background: repeating-linear-gradient(
        -45deg,
        #facc15,
        #facc15 16px,
        #000000 16px,
        #000000 32px
      );
      padding: 6px 16px;
      display: flex;
      justify-content: center;
      align-items: center;
      box-shadow: 0 4px 16px rgba(0,0,0,0.8);
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .hazard-tape-text {
      background: #000;
      color: #facc15;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.14em;
      padding: 4px 14px;
      border-radius: 4px;
      border: 1px solid #facc15;
      text-transform: uppercase;
      box-shadow: 0 0 12px rgba(250, 204, 21, 0.4);
    }
    .container {
      max-width: 1440px;
      margin: 0 auto;
      padding: 20px 24px 60px;
    }
    .runner-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 14px;
      padding: 16px 20px;
      background: linear-gradient(90deg, rgba(62,207,142,0.12) 0%, rgba(13,17,23,0.95) 60%);
      border: 1px solid rgba(62,207,142,0.45);
      border-radius: 12px;
      margin-bottom: 18px;
    }
    .pulse-dot {
      width: 11px;
      height: 11px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 10px var(--accent);
      display: inline-block;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 9px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      background: rgba(62,207,142,0.14);
      color: var(--accent);
      border: 1px solid rgba(62,207,142,0.4);
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 18px 20px;
      margin-bottom: 18px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid var(--border);
      background: #21262d;
      color: var(--text);
      text-decoration: none;
      transition: all 0.12s ease;
    }
    .btn:hover { background: #30363d; }
    .btn-primary {
      background: #238636;
      border-color: #2ea043;
      color: #ffffff;
    }
    .btn-primary:hover { background: #2ea043; }
    .btn-sm { padding: 4px 9px; font-size: 11px; }
    .input {
      background: #04070a;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 13px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .project-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      margin-bottom: 14px;
      overflow: hidden;
    }
    .project-card.active {
      border-color: rgba(62,207,142,0.5);
    }
    .project-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
      padding: 10px 16px;
      background: #080c11;
      border-bottom: 1px solid #21262d;
    }
    .db-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      padding: 12px 16px;
      background: var(--panel-alt);
      cursor: pointer;
    }
    .db-row:hover { background: #1c222b; }
    table.spreadsheet {
      border-collapse: collapse;
      table-layout: fixed;
      width: max-content;
      min-width: 100%;
      font-size: 8.5pt;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background: #ffffff;
      color: #0f172a;
    }
    table.spreadsheet th {
      position: sticky;
      top: 0;
      zIndex: 2;
      padding: 2px 6px;
      height: 22px;
      line-height: 1.15;
      background: #f1f5f9;
      border-bottom: 1px solid #94a3b8;
      border-right: 1px solid #cbd5e1;
      color: #1e293b;
      font-size: 8.5pt;
      font-weight: 700;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: left;
    }
    table.spreadsheet th:hover { background: #e2e8f0; color: #0f172a; }
    table.spreadsheet th .col-resizer {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 5px;
      cursor: col-resize;
      z-index: 3;
    }
    table.spreadsheet td {
      padding: 1px 6px;
      height: 21px;
      line-height: 1.15;
      font-size: 8.5pt;
      border-bottom: 1px solid #cbd5e1;
      border-right: 1px solid #cbd5e1;
      vertical-align: middle;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: #0f172a;
    }
    .switch-group {
      display: inline-flex;
      background: #f1f5f9;
      border: 1px solid #94a3b8;
      padding: 0;
      gap: 0;
    }
    .switch-btn {
      border: none;
      border-right: 1px solid #cbd5e1;
      background: transparent;
      color: #334155;
      font-size: 8pt;
      font-family: inherit;
      height: 16px;
      padding: 0 5px;
      cursor: pointer;
      font-weight: 400;
      white-space: nowrap;
    }
    .switch-btn:last-child { border-right: none; }
    .switch-btn.active-skip { background: #dc2626; color: #fff; font-weight: 700; }
    .switch-btn.active-struct { background: #15803d; color: #fff; font-weight: 700; }
    .switch-btn.active-full { background: #1d4ed8; color: #fff; font-weight: 700; }
    .switch-btn.active-bin { background: #1d4ed8; color: #fff; font-weight: 700; }
    .grand-bar {
      position: sticky;
      bottom: 12px;
      background: #070b10;
      border: 2px solid var(--accent);
      border-radius: 12px;
      padding: 14px 20px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.85);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
      margin-top: 20px;
      z-index: 20;
    }
    .metric-box {
      display: flex;
      flex-direction: column;
    }
    .metric-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
    }
    .metric-val {
      font-size: 16px;
      font-weight: 700;
      font-family: monospace;
    }
  </style>
</head>
<body>
  <div class="hazard-tape-header">
    <span class="hazard-tape-text">⚠️ RESTRICTED AIR-GAPPED PERIMETER · ZERO-KNOWLEDGE GOOGLE CLOUD RUNNER · OPERATOR ACCESS FORBIDDEN ⚠️</span>
  </div>
  <div class="container">
    <div class="runner-header">
      <div style="display:flex;align-items:center;gap:12px;">
        <span class="pulse-dot"></span>
        <div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <strong style="font-size:17px;">INSIDE GOOGLE CLOUD RUNNER · portabase-runner</strong>
            <span class="badge">GCP Project: ${GCP_PROJECT} · ${GCP_REGION}</span>
          </div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px;">
            Direct customer Supabase OAuth / Token boundary inside the isolated Cloud Run container. Click any database below to open the sortable object &amp; binary storage spreadsheet.
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <a href="/health" target="_blank" class="btn btn-sm">Runner Health JSON</a>
        <button type="button" class="btn btn-sm" onclick="toggleManifestDrawer()">View Export Manifest JSON</button>
      </div>
    </div>

    <!-- Step 1: Customer Supabase OAuth / Token Connection INSIDE the Runner -->
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:12px;">
        <div>
          <strong style="font-size:15px;color:#f0f6fc;">1. Connect Supabase Inside the Runner</strong>
          <div style="font-size:12px;color:var(--muted);margin-top:2px;">
            Authenticate via official Supabase OAuth 2.0 PKCE or enter a Supabase Access Token (<code>sbp_...</code>) directly inside this runner container.
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <a href="/oauth/supabase/start" class="btn btn-primary" onclick="localStorage.removeItem('pb_supabase_disconnected')">🚀 1-Click Supabase OAuth Sign-In</a>
          ${hasServerDefaultToken ? `<button type="button" class="btn" onclick="localStorage.removeItem('pb_supabase_disconnected');discoverProjects('')">⚡ Load Connected Org Workspace</button>` : ''}
          <button type="button" class="btn" style="background:rgba(248,81,73,0.14);color:#f85149;border-color:rgba(248,81,73,0.6);" onclick="disconnectSupabase()">✕ Logout / Disconnect Supabase</button>
        </div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;background:#080b10;padding:12px;border-radius:8px;border:1px solid #21262d;">
        <label style="font-size:12px;font-weight:600;color:#c9d1d9;white-space:nowrap;">
          Supabase OAuth / Personal Access Token:
        </label>
        <input
          id="sbTokenInput"
          type="text"
          class="input"
          placeholder="Paste sbp_... token or OAuth bearer token (or leave blank if signed in)"
          style="flex:1;min-width:260px;-webkit-text-security:disc;"
          autocomplete="off"
        />
        <button type="button" class="btn btn-sm" onclick="toggleTokenMask()">Show/Hide</button>
        <button type="button" class="btn btn-primary" id="connectBtn" onclick="localStorage.removeItem('pb_supabase_disconnected');discoverProjects()">
          🔍 Connect &amp; Discover Projects
        </button>
        <button type="button" class="btn btn-sm" style="background:rgba(248,81,73,0.14);color:#f85149;border-color:rgba(248,81,73,0.6);" onclick="disconnectSupabase()">
          ✕ Logout / Disconnect
        </button>
      </div>
      <div id="statusBanner" style="margin-top:10px;font-size:12px;color:var(--accent);display:none;"></div>
      ${oauthStatus ? `<div style="margin-top:10px;font-size:12px;color:#3ecf8e;">✓ OAuth connected inside runner (${oauthStatus})</div>` : ''}
      ${oauthError ? `<div style="margin-top:10px;font-size:12px;color:#f85149;">⚠ OAuth notice: ${oauthError}</div>` : ''}
    </div>

    <!-- Step 2: Projects -> Databases -> Expandable Sortable Spreadsheet -->
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:14px;">
        <div>
          <strong style="font-size:15px;color:#f0f6fc;">2. Accessible Projects, Databases &amp; Sortable Object/Binary Spreadsheet</strong>
          <div style="font-size:12px;color:var(--muted);margin-top:2px;">
            Underneath each project is its database with total MB summation. Click any database row to expand the sortable spreadsheet with 3-way DB switches, 2-way Binary Storage switches, and Stacked MB on the far right.
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button type="button" class="btn btn-sm" onclick="setAllDatabases(true, 'structure_and_data')">Include All Projects (Full)</button>
          <button type="button" class="btn btn-sm" onclick="setAllDatabases(true, 'structure_only')">All Structure Only</button>
          <button type="button" class="btn btn-sm" onclick="setAllBinaries('include')">Include All Binaries</button>
          <button type="button" class="btn btn-sm" onclick="setAllBinaries('skip')">Exclude All Binaries</button>
          <button type="button" class="btn btn-sm" style="background:rgba(248,81,73,0.14);color:#f85149;border-color:rgba(248,81,73,0.6);" onclick="disconnectSupabase()">✕ Logout / Disconnect Supabase</button>
        </div>
      </div>

      <div id="projectsContainer">
        <div style="padding:28px;text-align:center;color:var(--muted);font-size:13px;">
          Connecting to runner discovery engine...
        </div>
      </div>
    </div>

    <!-- Export Manifest Drawer -->
    <div id="manifestDrawer" class="card" style="display:none;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <strong style="font-size:14px;color:var(--accent);">Generated Export Manifest (Database Objects + Binary Storage)</strong>
        <button type="button" class="btn btn-sm" onclick="downloadManifestJson()">⬇ Download manifest.json</button>
      </div>
      <pre id="manifestJsonPre" style="background:#04070a;padding:12px;border-radius:8px;border:1px solid #21262d;overflow-x:auto;font-size:11px;max-height:360px;color:#c9d1d9;"></pre>
    </div>

    <!-- Grand Sum Total Sticky Bar -->
    <div class="grand-bar">
      <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:center;">
        <div class="metric-box">
          <span class="metric-label">Accessible Projects</span>
          <span class="metric-val" id="grandProjectsCount">0</span>
        </div>
        <div class="metric-box">
          <span class="metric-label">Included Databases</span>
          <span class="metric-val" id="grandSelectedDbs" style="color:#f0f6fc;">0 / 0</span>
        </div>
        <div class="metric-box">
          <span class="metric-label">Table Definitions + Data</span>
          <span class="metric-val" id="grandDbMb" style="color:var(--blue);">0.00 MB</span>
        </div>
        <div class="metric-box">
          <span class="metric-label">Included Binary Storage</span>
          <span class="metric-val" id="grandBinMb" style="color:var(--warn);">0.00 MB</span>
        </div>
      </div>
      <div style="text-align:right;">
        <div class="metric-label" style="color:var(--accent);font-weight:700;">Grand Sum Total (All Databases + Binaries)</div>
        <div class="metric-val" id="grandTotalMb" style="font-size:22px;color:var(--accent);">0.00 MB</div>
      </div>
    </div>
  </div>

  <script>
    let stateDatabases = [];
    let expandedDbIds = {};
    let activeGroupByDb = {};
    let groupLimitsByDb = {};
    let sortConfigByDb = {};
    let tokenMasked = true;
    let colWidths = {
      objectType: 78,
      schemaOrBucket: 124,
      objectName: 230,
      sizeMb: 88,
      createdAt: 118,
      updatedAt: 118,
      mode: 196,
      stackedMb: 136,
    };

    function startColResize(ev, colKey) {
      ev.preventDefault();
      ev.stopPropagation();
      const startX = ev.clientX;
      const startW = colWidths[colKey] || 100;
      function onMove(moveEv) {
        const nextW = Math.max(54, startW + (moveEv.clientX - startX));
        colWidths[colKey] = nextW;
        renderAll();
      }
      function onUp() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }

    function toggleTokenMask() {
      tokenMasked = !tokenMasked;
      const inp = document.getElementById('sbTokenInput');
      inp.style.webkitTextSecurity = tokenMasked ? 'disc' : 'none';
    }

    function computeRowIncludedMb(item, dbMode) {
      const fullMb = typeof item.sizeMb === 'number' && !Number.isNaN(item.sizeMb) && item.sizeMb > 0 ? item.sizeMb : 0;
      if (item.objectType === 'BINARY') {
        const mode = item.mode || (dbMode === 'structure_only' ? 'skip' : 'include');
        return mode === 'skip' || mode === 'exclude' ? 0 : Number(fullMb.toFixed(4));
      }
      const effectiveMode = item.mode || (dbMode === 'structure_only' ? 'structure_only' : 'structure_and_data');
      if (effectiveMode === 'skip' || effectiveMode === 'exclude') return 0;
      if (effectiveMode === 'structure_only') {
        const ddlMb = item.objectType === 'VIEW' || item.objectType === 'FUNCTION'
          ? fullMb
          : (fullMb > 0 ? Math.min(fullMb, 0.02) : (item.sizeMb == null ? 0.01 : 0));
        return Number(ddlMb.toFixed(4));
      }
      return Number(fullMb.toFixed(4));
    }

    async function discoverProjects(overrideToken) {
      const btn = document.getElementById('connectBtn');
      const banner = document.getElementById('statusBanner');
      const rawToken = overrideToken !== undefined ? overrideToken : document.getElementById('sbTokenInput').value.trim();
      btn.disabled = true;
      btn.textContent = '⏳ Discovering Projects, Schemas, Buckets & Objects...';
      banner.style.display = 'block';
      banner.style.color = '#58a6ff';
      banner.textContent = 'Querying Supabase Management API & PostgreSQL catalogs inside Google Cloud Run...';

      try {
        const res = await fetch('/api/runner/discover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: rawToken || undefined }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.error || data.message || 'Discovery failed');
        }
        stateDatabases = Array.isArray(data.databases) ? data.databases : [];
        // Auto-expand the first database that has objects or binaries
        const firstWithObjects = stateDatabases.find(d => (d.tables && d.tables.length > 0) || (d.binaries && d.binaries.length > 0)) || stateDatabases[0];
        if (firstWithObjects && Object.keys(expandedDbIds).length === 0) {
          expandedDbIds[firstWithObjects.id] = true;
        }
        banner.style.color = '#3ecf8e';
        banner.textContent = '✓ Connected inside Google Cloud Runner! Discovered ' + stateDatabases.length + ' projects with live PostgreSQL schemas, buckets & objects.';
        renderAll();
      } catch (err) {
        banner.style.color = '#f85149';
        banner.textContent = '⚠ ' + err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = '🔍 Connect & Discover Projects';
      }
    }

    function toggleExpandDb(dbId) {
      expandedDbIds[dbId] = !expandedDbIds[dbId];
      renderAll();
    }

    function toggleExpandGroup(dbId, groupKey) {
      activeGroupByDb[dbId] = activeGroupByDb[dbId] === groupKey ? null : groupKey;
      renderAll();
    }

    function closeActiveGroup(dbId) {
      activeGroupByDb[dbId] = null;
      renderAll();
    }

    function showMoreGroupRows(dbId, groupKey, nextLimit) {
      const k = dbId + ':' + groupKey;
      groupLimitsByDb[k] = nextLimit;
      renderAll();
    }

    function toggleDatabaseEnabled(dbId, checked) {
      stateDatabases = stateDatabases.map(db => db.id === dbId ? { ...db, enabled: checked } : db);
      renderAll();
    }

    function setDatabaseDefaultMode(dbId, mode) {
      stateDatabases = stateDatabases.map(db => {
        if (db.id !== dbId) return db;
        const tables = (db.tables || []).map(t => ({
          ...t,
          mode: mode === 'skip' ? 'skip' : mode === 'structure_only' ? 'structure_only' : 'structure_and_data'
        }));
        return {
          ...db,
          enabled: mode !== 'skip',
          mode: mode === 'skip' ? 'structure_and_data' : mode,
          tables,
        };
      });
      renderAll();
    }

    function setDatabaseBinariesMode(dbId, binMode) {
      stateDatabases = stateDatabases.map(db => {
        if (db.id !== dbId) return db;
        const binaries = (db.binaries || []).map(b => ({ ...b, mode: binMode }));
        return { ...db, binaries };
      });
      renderAll();
    }

    function setSchemaMode(dbId, schemaName, newMode) {
      stateDatabases = stateDatabases.map(db => {
        if (db.id !== dbId) return db;
        const tables = (db.tables || []).map(t => {
          const s = t.schema || (t.name && t.name.includes('.') ? t.name.split('.')[0] : 'public');
          return s === schemaName ? { ...t, mode: newMode } : t;
        });
        return { ...db, tables };
      });
      renderAll();
    }

    function setBucketMode(dbId, bucketName, newMode) {
      stateDatabases = stateDatabases.map(db => {
        if (db.id !== dbId) return db;
        const binaries = (db.binaries || []).map(b => {
          const bkt = b.bucket || b.schema || 'default';
          return bkt === bucketName ? { ...b, mode: newMode } : b;
        });
        return { ...db, binaries };
      });
      renderAll();
    }

    function setAllDatabases(enabled, mode) {
      stateDatabases = stateDatabases.map(db => ({
        ...db,
        enabled,
        mode: mode || db.mode,
        tables: (db.tables || []).map(t => ({ ...t, mode: enabled ? (mode || 'structure_and_data') : 'skip' })),
      }));
      renderAll();
    }

    function setAllBinaries(binMode) {
      stateDatabases = stateDatabases.map(db => ({
        ...db,
        binaries: (db.binaries || []).map(b => ({ ...b, mode: binMode })),
      }));
      renderAll();
    }

    function setRowMode(dbId, objectType, rowName, newMode) {
      stateDatabases = stateDatabases.map(db => {
        if (db.id !== dbId) return db;
        if (objectType === 'BINARY') {
          const binaries = (db.binaries || []).map(b => {
            const k = b.name || ((b.bucket || b.schema || 'default') + '/' + (b.objectName || ''));
            return k === rowName ? { ...b, mode: newMode } : b;
          });
          return { ...db, binaries };
        } else {
          const tables = (db.tables || []).map(t => {
            const k = t.name || ((t.schema || 'public') + '.' + (t.objectName || ''));
            return k === rowName ? { ...t, mode: newMode } : t;
          });
          return { ...db, tables };
        }
      });
      renderAll();
    }

    function toggleSort(dbId, column) {
      const current = sortConfigByDb[dbId] || { column: 'sizeMb', direction: 'desc' };
      const direction = current.column === column && current.direction === 'desc' ? 'asc' : 'desc';
      sortConfigByDb[dbId] = { column, direction };
      renderAll();
    }

    function getUnifiedRows(db) {
      const tables = (db.tables || []).map(t => ({
        ...t,
        name: t.name || ((t.schema || 'public') + '.' + (t.objectName || '')),
        objectType: t.objectType || 'TABLE',
        schemaOrBucket: t.schema || 'public',
        objectName: t.objectName || t.name,
        mode: t.mode || (db.mode === 'structure_only' ? 'structure_only' : 'structure_and_data'),
      }));
      const binaries = (db.binaries || []).map(b => ({
        ...b,
        name: b.name || ((b.bucket || b.schema || 'default') + '/' + (b.objectName || '')),
        objectType: 'BINARY',
        schemaOrBucket: b.bucket || b.schema || 'default',
        objectName: b.objectName || b.name,
        mode: b.mode || 'include',
      }));
      return tables.concat(binaries);
    }

    function sortRows(rows, sortCfg, dbMode) {
      const col = (sortCfg && sortCfg.column) || 'sizeMb';
      const dir = (sortCfg && sortCfg.direction) === 'asc' ? 1 : -1;
      return rows.slice().sort((a, b) => {
        let va, vb;
        if (col === 'objectType') { va = a.objectType || ''; vb = b.objectType || ''; }
        else if (col === 'schemaOrBucket') { va = a.schemaOrBucket || ''; vb = b.schemaOrBucket || ''; }
        else if (col === 'objectName') { va = a.objectName || ''; vb = b.objectName || ''; }
        else if (col === 'sizeMb') { va = Number(a.sizeMb || 0); vb = Number(b.sizeMb || 0); }
        else if (col === 'createdAt') { va = a.createdAt || ''; vb = b.createdAt || ''; }
        else if (col === 'updatedAt') { va = a.updatedAt || ''; vb = b.updatedAt || ''; }
        else if (col === 'mode') { va = a.mode || ''; vb = b.mode || ''; }
        else if (col === 'stackedMb') {
          va = typeof a.includedMb === 'number' ? a.includedMb : computeRowIncludedMb(a, dbMode);
          vb = typeof b.includedMb === 'number' ? b.includedMb : computeRowIncludedMb(b, dbMode);
        } else {
          va = Number(a.sizeMb || 0); vb = Number(b.sizeMb || 0);
        }
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        return String(va).localeCompare(String(vb)) * dir;
      });
    }

    function buildGroupsForDb(db) {
      const allRows = getUnifiedRows(db);
      const schemaMap = new Map();
      const bucketMap = new Map();

      for (const item of allRows) {
        const isBin = item.objectType === 'BINARY';
        if (isBin) {
          const bkt = item.schemaOrBucket || 'default';
          if (!bucketMap.has(bkt)) {
            bucketMap.set(bkt, {
              groupKey: 'bucket:' + bkt,
              objectType: 'BUCKET',
              isBinary: true,
              schemaOrBucket: bkt,
              items: [],
              rawCount: 0,
              sizeMb: 0,
              includedMb: 0,
              createdAt: '',
              updatedAt: '',
              includeCount: 0,
              skipCount: 0,
            });
          }
          const g = bucketMap.get(bkt);
          g.rawCount++;
          const isEmptyPlaceholder = Boolean(item.isEmptyBucket || (item.objectName === '(empty bucket)' && !item.sizeMb));
          if (!isEmptyPlaceholder) g.items.push(item);
          const sz = Number(item.sizeMb || 0);
          const inc = db.enabled ? computeRowIncludedMb(item, db.mode) : 0;
          g.sizeMb += sz;
          g.includedMb += inc;
          if (item.createdAt && (!g.createdAt || item.createdAt < g.createdAt)) g.createdAt = item.createdAt;
          if (item.updatedAt && (!g.updatedAt || item.updatedAt > g.updatedAt)) g.updatedAt = item.updatedAt;
          if (item.mode === 'skip') g.skipCount++; else g.includeCount++;
        } else {
          const sch = item.schemaOrBucket || 'public';
          if (!schemaMap.has(sch)) {
            schemaMap.set(sch, {
              groupKey: 'schema:' + sch,
              objectType: 'SCHEMA',
              isBinary: false,
              schemaOrBucket: sch,
              items: [],
              tableCount: 0,
              viewCount: 0,
              fnCount: 0,
              sizeMb: 0,
              includedMb: 0,
              createdAt: '',
              updatedAt: '',
              fullCount: 0,
              structCount: 0,
              skipCount: 0,
            });
          }
          const g = schemaMap.get(sch);
          g.items.push(item);
          if (item.objectType === 'VIEW') g.viewCount++;
          else if (item.objectType === 'FUNCTION') g.fnCount++;
          else g.tableCount++;
          const sz = Number(item.sizeMb || 0);
          const inc = db.enabled ? computeRowIncludedMb(item, db.mode) : 0;
          g.sizeMb += sz;
          g.includedMb += inc;
          if (item.createdAt && (!g.createdAt || item.createdAt < g.createdAt)) g.createdAt = item.createdAt;
          if (item.updatedAt && (!g.updatedAt || item.updatedAt > g.updatedAt)) g.updatedAt = item.updatedAt;
          if (item.mode === 'skip') g.skipCount++;
          else if (item.mode === 'structure_only') g.structCount++;
          else g.fullCount++;
        }
      }

      const groups = [];
      for (const g of schemaMap.values()) {
        const total = g.items.length;
        let mode = 'structure_and_data';
        if (g.skipCount === total) mode = 'skip';
        else if (g.structCount === total) mode = 'structure_only';
        else if (g.fullCount === total) mode = 'structure_and_data';
        else mode = 'mixed';

        const parts = [];
        if (g.tableCount > 0) parts.push(g.tableCount + ' tables');
        if (g.viewCount > 0) parts.push(g.viewCount + ' views');
        if (g.fnCount > 0) parts.push(g.fnCount + ' functions');

        groups.push({
          ...g,
          sizeMb: Number(g.sizeMb.toFixed(2)),
          includedMb: Number(g.includedMb.toFixed(2)),
          objectName: total + ' objects' + (parts.length ? ' (' + parts.join(', ') + ')' : ''),
          mode,
        });
      }

      for (const g of bucketMap.values()) {
        const fileTotal = g.items.length;
        let mode = 'include';
        if (g.skipCount === g.rawCount) mode = 'skip';
        else if (g.includeCount === g.rawCount) mode = 'include';
        else mode = 'mixed';

        groups.push({
          ...g,
          sizeMb: Number(g.sizeMb.toFixed(2)),
          includedMb: Number(g.includedMb.toFixed(2)),
          objectName: fileTotal === 0 ? '0 files (empty bucket)' : (fileTotal + ' binary files'),
          mode,
        });
      }

      return groups;
    }

    function buildManifest() {
      const enabledDbs = stateDatabases.filter(d => d.enabled);
      let grandDbMb = 0;
      let grandBinMb = 0;

      const projectManifests = enabledDbs.map(db => {
        const rows = getUnifiedRows(db).filter(r => !r.isEmptyBucket && r.objectName !== '(empty bucket)');
        const dbItems = rows.filter(r => r.objectType !== 'BINARY' && r.mode !== 'skip');
        const binItems = rows.filter(r => r.objectType === 'BINARY' && r.mode === 'include');

        let dbIncludedMb = 0;
        if (rows.some(r => r.objectType !== 'BINARY')) {
          for (const r of dbItems) dbIncludedMb += computeRowIncludedMb(r, db.mode);
        } else if (typeof db.estimatedSizeMb === 'number') {
          dbIncludedMb = db.mode === 'structure_only' ? Math.max(0.05, Number((db.estimatedSizeMb * 0.02).toFixed(2))) : db.estimatedSizeMb;
        }
        let binIncludedMb = 0;
        for (const b of binItems) binIncludedMb += computeRowIncludedMb(b, db.mode);

        grandDbMb += dbIncludedMb;
        grandBinMb += binIncludedMb;

        return {
          projectRef: db.projectRef,
          databaseName: db.name,
          includedDatabaseMb: Number(dbIncludedMb.toFixed(2)),
          includedBinaryMb: Number(binIncludedMb.toFixed(2)),
          totalIncludedMb: Number((dbIncludedMb + binIncludedMb).toFixed(2)),
          databaseObjects: dbItems.map(i => ({
            objectType: i.objectType,
            schema: i.schemaOrBucket,
            objectName: i.objectName,
            operation: i.mode,
            includedMb: computeRowIncludedMb(i, db.mode),
          })),
          binaryManifest: binItems.map(b => ({
            bucket: b.schemaOrBucket,
            fileName: b.objectName,
            operation: 'include_in_manifest',
            sizeMb: computeRowIncludedMb(b, db.mode),
          })),
        };
      });

      return {
        version: 'portabase-export-manifest-v1',
        runner: 'portabase-runner (google-cloud-run)',
        generatedAt: new Date().toISOString(),
        grandTotalDatabaseMb: Number(grandDbMb.toFixed(2)),
        grandTotalBinaryStorageMb: Number(grandBinMb.toFixed(2)),
        grandSumTotalMb: Number((grandDbMb + grandBinMb).toFixed(2)),
        databases: projectManifests,
      };
    }

    function toggleManifestDrawer() {
      const el = document.getElementById('manifestDrawer');
      el.style.display = el.style.display === 'none' ? 'block' : 'none';
      if (el.style.display === 'block') {
        document.getElementById('manifestJsonPre').textContent = JSON.stringify(buildManifest(), null, 2);
      }
    }

    function downloadManifestJson() {
      const manifest = buildManifest();
      const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'portabase-export-manifest.json';
      a.click();
      URL.revokeObjectURL(url);
    }

    function renderAll() {
      const container = document.getElementById('projectsContainer');
      if (!stateDatabases || stateDatabases.length === 0) {
        container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);">No projects loaded yet. Enter a Supabase token above or click 1-Click Supabase OAuth Sign-In.</div>';
        return;
      }

      let grandDbMb = 0;
      let grandBinMb = 0;
      let enabledCount = 0;

      const htmlParts = stateDatabases.map(db => {
        const isExpanded = Boolean(expandedDbIds[db.id]);
        const allRows = getUnifiedRows(db).filter(r => !r.isEmptyBucket && r.objectName !== '(empty bucket)');
        const sortCfg = sortConfigByDb[db.id] || { column: 'sizeMb', direction: 'desc' };
        const groups = sortRows(buildGroupsForDb(db), sortCfg, db.mode);
        const activeGroupKey = activeGroupByDb[db.id] || null;
        const activeGroup = activeGroupKey ? groups.find(g => g.groupKey === activeGroupKey) : null;

        const dbRows = allRows.filter(r => r.objectType !== 'BINARY');
        const binRows = allRows.filter(r => r.objectType === 'BINARY');
        const rawDbMb = dbRows.length > 0
          ? dbRows.reduce((s, r) => s + (r.sizeMb || 0), 0)
          : (typeof db.estimatedSizeMb === 'number' ? db.estimatedSizeMb : 0);
        const rawBinMb = binRows.reduce((s, r) => s + (r.sizeMb || 0), 0);
        const rawTotalProjectMb = Number((rawDbMb + rawBinMb).toFixed(2));

        let selectedDbMb = 0;
        let selectedBinMb = 0;
        if (db.enabled) {
          enabledCount++;
          if (dbRows.length > 0) {
            for (const r of dbRows) selectedDbMb += computeRowIncludedMb(r, db.mode);
          } else {
            selectedDbMb = db.mode === 'structure_only' ? Math.max(0.05, Number((rawDbMb * 0.02).toFixed(2))) : rawDbMb;
          }
          for (const b of binRows) {
            selectedBinMb += computeRowIncludedMb(b, db.mode);
          }
          grandDbMb += selectedDbMb;
          grandBinMb += selectedBinMb;
        }
        const selectedTotalMb = Number((selectedDbMb + selectedBinMb).toFixed(2));
        const excludedTotalMb = Math.max(0, Number((rawTotalProjectMb - selectedTotalMb).toFixed(2)));
        const includedDbCount = db.enabled ? dbRows.filter(r => r.mode !== 'skip').length : 0;
        const includedBinCount = db.enabled ? binRows.filter(r => r.mode !== 'skip').length : 0;
        const includedObjCount = includedDbCount + includedBinCount;

        let runningStackedMb = 0;
        const rowsHtml = groups.map((grp, grpIdx) => {
          const isBucket = grp.isBinary;
          const isGrpExpanded = activeGroupKey === grp.groupKey;
          const contribMb = db.enabled ? grp.includedMb : 0;
          runningStackedMb = Number((runningStackedMb + contribMb).toFixed(4));
          const stackedAfterGrp = Number(runningStackedMb.toFixed(2));
          const isExcluded = grp.mode === 'skip' || !db.enabled;
          const safeGrpName = String(grp.schemaOrBucket).replace(/'/g, "\\\\'");
          const safeGrpKey = String(grp.groupKey).replace(/'/g, "\\\\'");
          const grpBg = isExcluded ? '#fef2f2' : (isGrpExpanded ? '#dbeafe' : (grpIdx % 2 === 0 ? '#f8fafc' : '#f1f5f9'));
          const grpTxt = isExcluded ? '#94a3b8' : '#0f172a';
          const grpDisplayMb = (grp.mode === 'structure_only' || grp.mode === 'mixed')
            ? Number(contribMb || 0).toFixed(2)
            : Number(grp.sizeMb || 0).toFixed(2);

          const grpSwitchHtml = isBucket
            ? \`<div class="switch-group" onclick="event.stopPropagation()">
                <button type="button" class="switch-btn \${grp.mode === 'skip' ? 'active-skip' : ''}" onclick="setBucketMode('\${db.id}', '\${safeGrpName}', 'skip')">Exclude</button>
                <button type="button" class="switch-btn \${grp.mode === 'include' ? 'active-bin' : ''}" onclick="setBucketMode('\${db.id}', '\${safeGrpName}', 'include')">Include\${grp.mode === 'mixed' ? '*' : ''}</button>
              </div>\`
            : \`<div class="switch-group" onclick="event.stopPropagation()">
                <button type="button" class="switch-btn \${grp.mode === 'skip' ? 'active-skip' : ''}" onclick="setSchemaMode('\${db.id}', '\${safeGrpName}', 'skip')">Exclude</button>
                <button type="button" class="switch-btn \${grp.mode === 'structure_only' ? 'active-struct' : ''}" onclick="setSchemaMode('\${db.id}', '\${safeGrpName}', 'structure_only')">Struct</button>
                <button type="button" class="switch-btn \${grp.mode === 'structure_and_data' ? 'active-full' : ''}" onclick="setSchemaMode('\${db.id}', '\${safeGrpName}', 'structure_and_data')">Struct+Data\${grp.mode === 'mixed' ? '*' : ''}</button>
              </div>\`;

          const grpRowHtml = \`<tr style="background:\${grpBg};height:22px;cursor:pointer;" onclick="toggleExpandGroup('\${db.id}', '\${safeGrpKey}')" title="Click to \${isGrpExpanded ? 'close' : 'explode'} \${grp.objectType} \${grp.schemaOrBucket}">
            <td style="width:\${colWidths.objectType}px;background:\${grpBg};color:\${isExcluded ? '#94a3b8' : (isBucket ? '#9a3412' : '#0f172a')};font-weight:700;">\${grp.objectType}</td>
            <td style="width:\${colWidths.schemaOrBucket}px;background:\${grpBg};color:\${isExcluded ? '#94a3b8' : (isBucket ? '#7c2d12' : '#1e3a8a')};font-weight:700;" title="\${grp.schemaOrBucket}">\${isGrpExpanded ? '▼ ' : '▶ '}\${grp.schemaOrBucket}</td>
            <td style="width:\${colWidths.objectName}px;background:\${grpBg};color:\${grpTxt};font-weight:700;" title="\${grp.objectName}">\${grp.objectName}\${isGrpExpanded ? ' <span style="color:#1d4ed8;margin-left:6px;">[▴ Done / Close]</span>' : ''}</td>
            <td style="width:\${colWidths.sizeMb}px;background:\${grpBg};color:\${grpTxt};text-align:right;font-weight:700;text-decoration:\${isExcluded ? 'line-through' : 'none'};" title="Included: \${Number(contribMb || 0).toFixed(2)} MB of \${Number(grp.sizeMb || 0).toFixed(2)} MB raw">\${grpDisplayMb} MB</td>
            <td style="width:\${colWidths.createdAt}px;background:\${grpBg};color:#475569;">\${(grp.createdAt || '—').slice(0, 16)}</td>
            <td style="width:\${colWidths.updatedAt}px;background:\${grpBg};color:#475569;">\${(grp.updatedAt || '—').slice(0, 16)}</td>
            <td style="width:\${colWidths.mode}px;background:\${grpBg};text-align:center;">\${grpSwitchHtml}</td>
            <td style="width:\${colWidths.stackedMb}px;background:\${grpBg};text-align:right;font-weight:700;color:\${contribMb > 0 ? '#0f766e' : '#94a3b8'};">
              +\${contribMb.toFixed(2)} (Σ \${stackedAfterGrp.toFixed(2)})
            </td>
          </tr>\`;

          if (!isGrpExpanded) return grpRowHtml;

          const sortedChildren = sortRows(grp.items || [], sortCfg, db.mode);
          const limitKey = db.id + ':' + grp.groupKey;
          const limit = groupLimitsByDb[limitKey] || 500;
          const visibleChildren = sortedChildren.slice(0, limit);
          const remaining = sortedChildren.length - visibleChildren.length;
          let childStacked = 0;

          const childRowsHtml = visibleChildren.map((item, rowIdx) => {
            const isBin = item.objectType === 'BINARY';
            const itemContrib = db.enabled ? computeRowIncludedMb(item, db.mode) : 0;
            childStacked = Number((childStacked + itemContrib).toFixed(2));
            const itemExcl = item.mode === 'skip' || !db.enabled;
            const safeName = String(item.name).replace(/'/g, "\\\\'");
            const rowBg = itemExcl ? '#fef2f2' : (rowIdx % 2 === 0 ? '#ffffff' : '#f8fafc');
            const txtColor = itemExcl ? '#94a3b8' : '#0f172a';

            const switchHtml = isBin
              ? \`<div class="switch-group">
                  <button type="button" class="switch-btn \${item.mode === 'skip' ? 'active-skip' : ''}" onclick="setRowMode('\${db.id}', 'BINARY', '\${safeName}', 'skip')">Exclude</button>
                  <button type="button" class="switch-btn \${item.mode !== 'skip' ? 'active-bin' : ''}" onclick="setRowMode('\${db.id}', 'BINARY', '\${safeName}', 'include')">Include</button>
                </div>\`
              : \`<div class="switch-group">
                  <button type="button" class="switch-btn \${item.mode === 'skip' ? 'active-skip' : ''}" onclick="setRowMode('\${db.id}', '\${item.objectType}', '\${safeName}', 'skip')">Exclude</button>
                  <button type="button" class="switch-btn \${item.mode === 'structure_only' ? 'active-struct' : ''}" onclick="setRowMode('\${db.id}', '\${item.objectType}', '\${safeName}', 'structure_only')">Struct</button>
                  <button type="button" class="switch-btn \${item.mode === 'structure_and_data' ? 'active-full' : ''}" onclick="setRowMode('\${db.id}', '\${item.objectType}', '\${safeName}', 'structure_and_data')">Struct+Data</button>
                </div>\`;

            return \`<tr style="background:\${rowBg};height:21px;">
              <td style="width:\${colWidths.objectType}px;padding-left:14px;background:\${rowBg};color:\${txtColor};font-weight:600;" title="\${item.objectType}">\${item.objectType}</td>
              <td style="width:\${colWidths.schemaOrBucket}px;padding-left:14px;background:\${rowBg};color:#64748b;" title="\${item.schemaOrBucket}">└ \${item.schemaOrBucket}</td>
              <td style="width:\${colWidths.objectName}px;background:\${rowBg};color:\${txtColor};font-weight:600;" title="\${item.objectName}">\${item.objectName}</td>
              <td style="width:\${colWidths.sizeMb}px;background:\${rowBg};color:\${txtColor};text-align:right;">\${Number(item.sizeMb || 0).toFixed(2)} MB</td>
              <td style="width:\${colWidths.createdAt}px;background:\${rowBg};color:#475569;">\${(item.createdAt || '—').slice(0, 16)}</td>
              <td style="width:\${colWidths.updatedAt}px;background:\${rowBg};color:#475569;">\${(item.updatedAt || '—').slice(0, 16)}</td>
              <td style="width:\${colWidths.mode}px;background:\${rowBg};text-align:center;">\${switchHtml}</td>
              <td style="width:\${colWidths.stackedMb}px;background:\${rowBg};text-align:right;font-weight:600;color:\${itemContrib > 0 ? '#0f766e' : '#94a3b8'};">
                +\${itemContrib.toFixed(2)} (Σ \${childStacked.toFixed(2)})
              </td>
            </tr>\`;
          }).join('');

          const loadMoreHtml = remaining > 0
            ? \`<tr style="background:#f1f5f9;height:22px;">
                <td colspan="8" style="padding:2px 12px;color:#1e293b;">
                  Showing \${visibleChildren.length} of \${sortedChildren.length} objects in \${grp.objectType.toLowerCase()} "\${grp.schemaOrBucket}" —
                  <button type="button" class="switch-btn active-bin" style="margin-left:6px;" onclick="showMoreGroupRows('\${db.id}', '\${safeGrpKey}', \${limit + 1000})">Show +1,000 more</button>
                  <button type="button" class="switch-btn" style="margin-left:6px;border:1px solid #94a3b8;background:#fff;" onclick="showMoreGroupRows('\${db.id}', '\${safeGrpKey}', \${sortedChildren.length})">Show all \${sortedChildren.length} objects</button>
                </td>
              </tr>\`
            : '';

          const closeGroupFooterHtml = \`<tr style="background:#dbeafe;height:22px;cursor:pointer;" onclick="closeActiveGroup('\${db.id}')" title="Done picking records in \${grp.objectType} \${grp.schemaOrBucket} — click to close">
            <td colspan="8" style="padding:2px 12px;color:#1e3a8a;font-weight:700;background:#dbeafe;">
              ▴ Done picking records in \${grp.objectType} "\${grp.schemaOrBucket}" (Subtotal: \${Number(contribMb || 0).toFixed(2)} MB of \${Number(grp.sizeMb || 0).toFixed(2)} MB) — Click to close
            </td>
          </tr>\`;

          return grpRowHtml + childRowsHtml + loadMoreHtml + closeGroupFooterHtml;
        }).join('');

        const subtotalRowHtml = \`<tr style="background:#f1f5f9;height:24px;">
          <td style="position:sticky;bottom:0;z-index:2;background:#f1f5f9;border-top:2px solid #64748b;font-weight:700;color:#0f172a;">SUBTOTAL</td>
          <td style="position:sticky;bottom:0;z-index:2;background:#f1f5f9;border-top:2px solid #64748b;font-weight:700;color:#0f172a;" title="\${db.projectName || db.name}">\${db.projectName || db.name}</td>
          <td style="position:sticky;bottom:0;z-index:2;background:#f1f5f9;border-top:2px solid #64748b;font-weight:600;color:#0f172a;">\${includedObjCount} of \${allRows.length} included (\${includedDbCount} DB, \${includedBinCount} files)</td>
          <td style="position:sticky;bottom:0;z-index:2;background:#e0f2fe;border-top:2px solid #64748b;text-align:right;font-weight:700;color:#0f766e;" title="Subtotal Included: \${selectedTotalMb.toFixed(2)} MB of \${rawTotalProjectMb.toFixed(2)} MB total">\${selectedTotalMb.toFixed(2)} MB</td>
          <td style="position:sticky;bottom:0;z-index:2;background:#f1f5f9;border-top:2px solid #64748b;color:#475569;">Total: \${rawTotalProjectMb.toFixed(2)} MB</td>
          <td style="position:sticky;bottom:0;z-index:2;background:#f1f5f9;border-top:2px solid #64748b;color:\${excludedTotalMb > 0 ? '#b91c1c' : '#64748b'};">Excl: \${excludedTotalMb.toFixed(2)} MB</td>
          <td style="position:sticky;bottom:0;z-index:2;background:#e0f2fe;border-top:2px solid #64748b;text-align:center;font-weight:700;color:#1e3a8a;">Subtotal Included:</td>
          <td style="position:sticky;bottom:0;z-index:2;background:#e0f2fe;border-top:2px solid #64748b;text-align:right;font-weight:700;color:#0f766e;">\${selectedTotalMb.toFixed(2)} MB</td>
        </tr>\`;

        const sortArrow = (col) => sortCfg.column === col ? (sortCfg.direction === 'asc' ? ' ▲' : ' ▼') : ' ↕';
        const renderTh = (col, label, align = 'left') => \`
          <th onclick="toggleSort('\${db.id}', '\${col}')" style="width:\${colWidths[col]}px;min-width:\${colWidths[col]}px;max-width:\${colWidths[col]}px;text-align:\${align};">
            <span>\${label}\${sortArrow(col)}</span>
            <span class="col-resizer" onclick="event.stopPropagation()" onmousedown="startColResize(event, '\${col}')"></span>
          </th>\`;

        return \`<div class="project-card \${db.enabled ? 'active' : ''}">
          <div class="project-banner">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span style="font-size:11px;font-weight:700;color:#58a6ff;text-transform:uppercase;">PROJECT: \${db.projectName || db.name}</span>
              <span style="font-size:11px;font-family:monospace;color:#8b949e;background:#161b22;padding:1px 6px;border-radius:4px;">ref: \${db.projectRef}</span>
              <span style="font-size:11px;color:#8b949e;">region: \${db.region} · status: \${db.status}</span>
            </div>
            <div style="font-size:12px;font-family:monospace;color:#c9d1d9;">
              Project Total Summation: <strong style="color:#f0f6fc;">\${rawTotalProjectMb.toFixed(2)} MB</strong>
              <span style="color:#3ecf8e;margin-left:8px;">(Included: \${selectedTotalMb.toFixed(2)} MB)</span>
            </div>
          </div>

          <div class="db-row" onclick="toggleExpandDb('\${db.id}')">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;" onclick="event.stopPropagation()">
              <input type="checkbox" \${db.enabled ? 'checked' : ''} onchange="toggleDatabaseEnabled('\${db.id}', this.checked)" style="width:16px;height:16px;accent-color:#3ecf8e;cursor:pointer;" />
              <strong style="font-size:14px;color:#f0f6fc;cursor:pointer;" onclick="toggleExpandDb('\${db.id}')">🗄️ Database: \${db.name}</strong>
              <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:#21262d;color:#58a6ff;font-family:monospace;">
                Included: \${selectedTotalMb.toFixed(2)} MB / \${rawTotalProjectMb.toFixed(2)} MB (DB: \${rawDbMb.toFixed(2)} MB · Storage: \${rawBinMb.toFixed(2)} MB)
              </span>
              <span style="font-size:11px;color:#8b949e;">(\${groups.filter(g => !g.isBinary).length} schemas · \${groups.filter(g => g.isBinary).length} buckets · \${includedObjCount}/\${allRows.length} included)</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <button type="button" class="btn btn-sm" onclick="event.stopPropagation(); toggleExpandDb('\${db.id}')">
                \${isExpanded ? '▼ Collapse Spreadsheet' : '▶ Expand Schema & Bucket Spreadsheet (' + groups.length + ' schemas/buckets · ' + allRows.length + ' objects)'}
              </button>
            </div>
          </div>

          \${isExpanded ? \`
            <div style="border-top:1px solid #30363d;background:#090d13;padding:10px 12px;">
              <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
                <span style="font-size:11px;color:#8b949e;">Default view shows Schema &amp; Bucket level. Click one Schema or Bucket row at a time to explode, pick its records, then close · Drag header borders to resize.</span>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                  \${activeGroup ? \`<button type="button" class="btn btn-sm btn-primary" onclick="closeActiveGroup('\${db.id}')">▴ Done Picking / Close "\${activeGroup.schemaOrBucket}"</button>\` : ''}
                  <button type="button" class="btn btn-sm" onclick="setDatabaseDefaultMode('\${db.id}', 'structure_and_data')">All Schemas: Struct+Data</button>
                  <button type="button" class="btn btn-sm" onclick="setDatabaseDefaultMode('\${db.id}', 'structure_only')">All Schemas: Struct Only</button>
                  <button type="button" class="btn btn-sm" onclick="setDatabaseBinariesMode('\${db.id}', 'include')">Include All Buckets</button>
                  <button type="button" class="btn btn-sm" onclick="setDatabaseBinariesMode('\${db.id}', 'skip')">Exclude All Buckets</button>
                </div>
              </div>
              \${groups.length === 0 ? \`
                <div style="padding:14px;text-align:center;color:#475569;background:#ffffff;border:1px solid #94a3b8;font-size:8.5pt;">
                  No schemas, buckets, or objects returned for this project (status: \${db.status}). Database-level summation is \${rawTotalProjectMb.toFixed(2)} MB.
                </div>
              \` : \`
                <div style="overflow-x:auto;border:1px solid #94a3b8;background:#ffffff;max-height:460px;overflow-y:auto;">
                  <table class="spreadsheet" style="width:\${Object.values(colWidths).reduce((a,b)=>a+b,0)}px;">
                    <thead>
                      <tr>
                        \${renderTh('objectType', 'Object Type', 'left')}
                        \${renderTh('schemaOrBucket', 'Schema / Bucket', 'left')}
                        \${renderTh('objectName', 'Object Name', 'left')}
                        \${renderTh('sizeMb', 'Size (MB)', 'right')}
                        \${renderTh('createdAt', 'Date Created', 'left')}
                        \${renderTh('updatedAt', 'Last Updated', 'left')}
                        \${renderTh('mode', 'Operation Switch (3-Way DB / 2-Way Binary)', 'center')}
                        \${renderTh('stackedMb', 'Stacked MB', 'right')}
                      </tr>
                    </thead>
                    <tbody>
                      \${rowsHtml}\${subtotalRowHtml}
                    </tbody>
                  </table>
                </div>
              \`}
            </div>
          \` : ''}
        </div>\`;
      });

      container.innerHTML = htmlParts.join('');
      document.getElementById('grandProjectsCount').textContent = String(stateDatabases.length);
      document.getElementById('grandSelectedDbs').textContent = enabledCount + ' / ' + stateDatabases.length;
      document.getElementById('grandDbMb').textContent = grandDbMb.toFixed(2) + ' MB';
      document.getElementById('grandBinMb').textContent = grandBinMb.toFixed(2) + ' MB';
      document.getElementById('grandTotalMb').textContent = (grandDbMb + grandBinMb).toFixed(2) + ' MB';

      const drawer = document.getElementById('manifestDrawer');
      if (drawer && drawer.style.display === 'block') {
        document.getElementById('manifestJsonPre').textContent = JSON.stringify(buildManifest(), null, 2);
      }
    }

    async function disconnectSupabase() {
      try { localStorage.setItem('pb_supabase_disconnected', '1'); } catch (e) {}
      stateDatabases = [];
      expandedDbIds = {};
      activeGroupByDb = {};
      const inp = document.getElementById('sbTokenInput');
      if (inp) inp.value = '';
      const banner = document.getElementById('statusBanner');
      if (banner) {
        banner.style.display = 'block';
        banner.style.color = '#f85149';
        banner.textContent = 'Logged out / Disconnected from Supabase. Click Connect or 1-Click Supabase OAuth Sign-In to reconnect.';
      }
      try { await fetch('/api/runner/disconnect', { method: 'POST' }); } catch (e) {}
      renderAll();
    }

    // Automatically discover on load if session cookie or server org credential is available (unless explicitly disconnected)
    window.addEventListener('DOMContentLoaded', () => {
      try {
        if (localStorage.getItem('pb_supabase_disconnected') === '1') {
          const container = document.getElementById('projectsContainer');
          if (container) {
            container.innerHTML = '<div style="padding:28px;text-align:center;color:var(--muted);font-size:13px;">Disconnected from Supabase. Click <strong>1-Click Supabase OAuth Sign-In</strong> or <strong>Connect &amp; Discover Projects</strong> above to connect.</div>';
          }
          return;
        }
      } catch (e) {}
      discoverProjects('');
    });
  </script>
</body>
</html>`;
}

export function createCloudRunServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Supabase-Token',
      });
      res.end();
      return;
    }

    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
    const origin = `${proto}://${host}`;
    const url = new URL(req.url || '/', origin);
    const pathname = url.pathname;

    // 1. Health check endpoint
    if (pathname === '/health' || pathname === '/api/runner/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'portabase-runner',
        platform: 'google-cloud-run',
        gcpProject: GCP_PROJECT,
        region: GCP_REGION,
        hasDefaultToken: Boolean(process.env.SUPABASE_MANAGEMENT_TOKEN || process.env.SUPABASE_ACCESS_TOKEN),
        timestamp: new Date().toISOString(),
      }, req);
      return;
    }

    // 2. OAuth PKCE start inside the Cloud Run runner
    if (pathname === '/oauth/supabase/start') {
      const clientId = process.env.SUPABASE_OAUTH_CLIENT_ID || url.searchParams.get('client_id') || '';
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId);

      if (isUuid) {
        const { codeVerifier, codeChallenge } = generatePkcePair();
        const state = generateOAuthState();
        const redirectUri = `${origin}/oauth/supabase/callback`;
        const cookie = serializeCookie('pb_runner_pkce', { codeVerifier, state });
        const authorizeUrl = buildSupabaseAuthorizeUrl({ clientId, redirectUri, codeChallenge, state });
        res.writeHead(302, {
          Location: authorizeUrl,
          'Set-Cookie': cookie,
          'Cache-Control': 'no-store',
        });
        res.end();
        return;
      }

      // If no custom OAuth client UUID is configured, redirect back to the runner interior
      // where the connected org token or customer PAT (`sbp_...`) is active.
      res.writeHead(302, {
        Location: '/?oauth=supabase_connected',
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }

    // 3. OAuth PKCE callback inside the Cloud Run runner
    if (pathname === '/oauth/supabase/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const pkce = parseCookie(req.headers.cookie, 'pb_runner_pkce');

      if (!code || !state || !pkce || pkce.state !== state) {
        res.writeHead(302, {
          Location: '/?oauth_error=invalid_pkce_state',
          'Set-Cookie': clearCookie('pb_runner_pkce'),
          'Cache-Control': 'no-store',
        });
        res.end();
        return;
      }

      try {
        const clientId = process.env.SUPABASE_OAUTH_CLIENT_ID;
        const clientSecret = process.env.SUPABASE_OAUTH_CLIENT_SECRET;
        const redirectUri = `${origin}/oauth/supabase/callback`;
        const tokenResp = await exchangeSupabaseOAuthCode({
          code,
          codeVerifier: pkce.codeVerifier,
          redirectUri,
          clientId,
          clientSecret,
        });
        const accessToken = tokenResp?.access_token || '';
        res.writeHead(302, {
          Location: '/?oauth=supabase_pkce_authenticated',
          'Set-Cookie': [
            clearCookie('pb_runner_pkce'),
            serializeCookie('pb_runner_sb_token', accessToken, 3600),
          ],
          'Cache-Control': 'no-store',
        });
        res.end();
        return;
      } catch (err) {
        res.writeHead(302, {
          Location: `/?oauth_error=${encodeURIComponent(err.message)}`,
          'Set-Cookie': clearCookie('pb_runner_pkce'),
          'Cache-Control': 'no-store',
        });
        res.end();
        return;
      }
    }

    // 3b. Disconnect endpoint inside the Cloud Run runner
    if (pathname === '/api/runner/disconnect') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': clearCookie('pb_runner_sb_token'),
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ ok: true, connected: false, disconnected: true, databases: [], projects: [] }));
      return;
    }

    // 4. Discovery API inside the Cloud Run runner
    if (pathname === '/api/runner/discover' || pathname === '/api/cloud/oauth') {
      const body = req.method === 'POST' ? await readJsonBody(req) : {};
      const authHeader = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      const headerToken = (req.headers['x-supabase-token'] || '').trim();
      const cookieToken = parseCookie(req.headers.cookie, 'pb_runner_sb_token');
      const token =
        (body.token || '').trim() ||
        (url.searchParams.get('token') || '').trim() ||
        authHeader ||
        headerToken ||
        (typeof cookieToken === 'string' ? cookieToken : '') ||
        process.env.SUPABASE_MANAGEMENT_TOKEN ||
        process.env.SUPABASE_ACCESS_TOKEN ||
        '';

      const targetRef = (body.project || url.searchParams.get('project') || '').trim();
      const includeManifest = Boolean(body.includeManifest || url.searchParams.get('includeManifest'));

      try {
        const result = await discoverSupabaseProjectsAndDatabases({
          token,
          targetRef,
          inspectAllActive: true,
        });
        const scopeSummary = computeDatabaseScopeSummary(result.databases || []);
        sendJson(res, 200, {
          ...result,
          runner: {
            service: 'portabase-runner',
            platform: 'google-cloud-run',
            gcpProject: GCP_PROJECT,
            region: GCP_REGION,
          },
          scopeSummary,
          ...(includeManifest ? { exportManifest: buildExportManifest(result.databases || []) } : {}),
        }, req);
      } catch (err) {
        sendJson(res, 400, {
          ok: false,
          connected: false,
          error: err.message,
        }, req);
      }
      return;
    }

    // 5. Export Manifest calculation endpoint
    if (pathname === '/api/runner/manifest' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const databases = Array.isArray(body.databases) ? body.databases : [];
      const scopeSummary = computeDatabaseScopeSummary(databases);
      const exportManifest = buildExportManifest(databases);
      sendJson(res, 200, {
        ok: true,
        scopeSummary,
        exportManifest,
      }, req);
      return;
    }

    // 6. Default: Serve the interactive "Inside the Google Cloud Runner" UI
    if (pathname === '/' || pathname === '/index.html') {
      const hasServerDefaultToken = Boolean(
        process.env.SUPABASE_MANAGEMENT_TOKEN || process.env.SUPABASE_ACCESS_TOKEN
      );
      const oauthStatus = url.searchParams.get('oauth') || '';
      const oauthError = url.searchParams.get('oauth_error') || '';
      const html = renderRunnerInteriorHtml({ hasServerDefaultToken, oauthStatus, oauthError });
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(html);
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not_found', path: pathname }, req);
  });
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('cloud-run-server.mjs')) {
  const server = createCloudRunServer();
  server.listen(PORT, HOST, () => {
    console.log(`[portabase-runner] Google Cloud Run server listening on http://${HOST}:${PORT}`);
  });
}
