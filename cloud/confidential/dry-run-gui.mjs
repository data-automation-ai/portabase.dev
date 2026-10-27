import {sourceObjectPicker,pickerCss} from './source-object-picker.mjs';
import {machineCss,transferView,dataPipe,capsuleJar} from './machine-visual.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CALLBACK='https://portabase.dev/confidential/callback';

export function parsePastedCallback(value) {
  let url;
  try { url=new URL(value); } catch { throw new Error('invalid_oauth_callback'); }
  if(url.origin+url.pathname!==CALLBACK||url.username||url.password||url.hash)throw new Error('invalid_oauth_callback');
  if(url.searchParams.has('error'))throw new Error('oauth_authorization_denied');
  const state=url.searchParams.getAll('state'),code=url.searchParams.getAll('code');
  if(state.length!==1||code.length!==1||!state[0]||!code[0]||code[0].length>4096)throw new Error('invalid_oauth_callback');
  return {state:state[0],code:code[0]};
}

const bytes=value=>Number.isFinite(value)?`${(value/1024**3).toFixed(2)} GiB`:'pending';
const inventorySize=value=>Number.isFinite(value)?value>=1024**3?`${(value/1024**3).toFixed(2)} GiB`:`${(value/1024**2).toFixed(1)} MiB`:'unknown';

const awsSvg = `<span class="provider-badge aws-badge"><svg width="18" height="12" viewBox="0 0 18 12" fill="none"><path d="M2 7.5C5.5 10 11.5 10 15 7.5" stroke="#FF9900" stroke-width="1.6" stroke-linecap="round"/><path d="M13.5 7L15.5 7.5L14.5 9.5" stroke="#FF9900" stroke-width="1.3" stroke-linecap="round"/></svg>aws</span>`;
const supabaseSvg = `<span class="provider-badge supabase-badge"><svg width="12" height="14" viewBox="0 0 24 24" fill="none"><path d="M13.8 2.5L3.2 14.6C2.6 15.3 3.1 16.4 4 16.4H12.2L10.2 22.5L20.8 10.4C21.4 9.7 20.9 8.6 20 8.6H11.8L13.8 2.5Z" fill="#3ECF8E"/></svg>supabase</span>`;
const dropboxSvg = `<span class="provider-badge dropbox-badge"><svg width="14" height="13" viewBox="0 0 43 40" fill="#0061FF"><path d="M12.5 0L0 8.2l8.8 7.1 12.5-7.7L12.5 0zm18 0l-8.8 7.6 12.5 7.7 8.8-7.1L30.5 0zM0 22.4l12.5 8.2 8.8-7.4-12.5-7.7L0 22.4zm42.6 0l-12.5-7.7-12.5 7.7 8.8 7.4 16.2-7.4zM21.3 25.1l-8.8 7.3-3.7-2.4v3.5l12.5 7.5 12.5-7.5v-3.5l-3.7 2.4-8.8-7.3z"/></svg>Dropbox</span>`;
const s3Svg = `<span class="provider-badge s3-badge"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 6C4 4.3 7.6 3 12 3s8 1.3 8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3V6z" stroke="#FF9900" stroke-width="1.5"/><ellipse cx="12" cy="6" rx="8" ry="3" stroke="#FF9900" stroke-width="1.5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" stroke="#FF9900" stroke-width="1.5"/></svg>aws S3</span>`;

function connection(slot,connected,projects,selected,link,nonce,account,allowOverwrite=true) {
  const isSource = slot === 'source';
  const label = isSource ? 'Source Supabase' : 'Destination Supabase';
  const guidance = slot === 'target' ? '<p><strong>Use your separate destination Supabase account.</strong> On the Supabase authorization screen, check the <em>Authorizing as</em> email. If it shows your Source account, click <em>Sign out</em> there, then sign in with the Destination account before approving.</p>' : '';
  const badges = `<span style="display:inline-flex;gap:4px;margin-left:auto">${awsSvg}${supabaseSvg}</span>`;
  if(!connected) return `<section class="connection"><h2><span>${label}</span>${badges}</h2>${guidance}<p>Authorize Supabase to inspect projects for this connection.</p><a href="${esc(link)}" target="_blank" rel="noreferrer" data-oauth-popup="true">Authorize ${slot}</a></section>`;
  const options=projects.map(p=>`<option value="${esc(p.ref)}"${p.ref===selected?' selected':''}>${esc(p.name)} (${esc(p.ref)})</option>`).join('');
  if(isSource) return `<section class="connection"><h2><span>${label}</span>${badges}</h2><p><strong>${esc(projects.find(p=>p.ref===selected)?.name||'Choose source project')}</strong><small class="project-ref">${esc(selected)}</small></p><form method="post" action="/select"><input type="hidden" name="nonce" value="${esc(nonce)}"><input type="hidden" name="slot" value="source"><label>Choose the source project to capture<select name="ref" required><option value="">Choose a project</option>${options}</select></label><button type="submit">Check source</button></form><p>Choose database objects from the center machine.</p><details${link?' open':''}><summary>Source connection settings</summary><p>Account: ${esc(account?.verified?account.email:'Supabase does not expose account identity for this grant')}</p><form method="post" action="/reauthorize"><input type="hidden" name="nonce" value="${esc(nonce)}"><input type="hidden" name="slot" value="source"><button type="submit">Authorize a different source account</button></form>${link?`<p>New authorization link: <a href="${esc(link)}" target="_blank" rel="noreferrer" data-oauth-popup="true">Open Supabase authorization</a></p>`:''}</details><small>${esc(projects.length)} project(s) available through this grant.</small></section>`;
  return `<section class="connection"><h2><span>${label}</span>${badges}</h2><form method="post" action="/select"><input type="hidden" name="nonce" value="${esc(nonce)}"><input type="hidden" name="slot" value="${slot}"><label>Choose the destination project to restore into<select name="ref" required><option value="">Choose a project</option>${options}</select></label><label class="object-row" style="border:0;padding:4px 0;margin:8px 0"><input type="checkbox" name="allowOverwrite" value="yes"${allowOverwrite!==false?' checked':''}><span>Allow overwrite of any existing content in destination</span><span></span></label><button type="submit">Check ${slot}</button></form><details${link?' open':''}><summary>Destination connection settings</summary><p>Account: ${esc(account?.verified?account.email:'Supabase does not expose account identity for this grant')}</p>${guidance}<form method="post" action="/reauthorize"><input type="hidden" name="nonce" value="${esc(nonce)}"><input type="hidden" name="slot" value="${slot}"><button type="submit">Authorize a different ${slot} account</button></form>${link?`<p>New authorization link: <a href="${esc(link)}" target="_blank" rel="noreferrer" data-oauth-popup="true">Open Supabase account chooser</a></p>`:''}</details><small>${esc(projects.length)} project(s) available through this grant.</small></section>`;
}

function machineProgress(status) {
  const backup=status.backup;
  let capture='No capsule capture has started.';
  if(backup){
    const raw=Number(backup.estimatedPercent);
    const valid=backup.progressKind==='estimate'&&Number.isInteger(raw)&&raw>=0;
    const phaseEstimate={'preflight':0,'database-manifest':2,database:5,storage:45,functions:78,package:85,encrypt:91,transfer:96,done:99}[backup.phase];
    const percent=backup.state==='complete'?100:valid?Math.min(raw,99):phaseEstimate??null;
    capture=percent===null?'Capsule capture is running; estimate pending.'
      :`<label for="capsule-progress">Estimated capsule creation: <strong>${percent}%</strong></label><progress id="capsule-progress" max="100" value="${percent}">${percent}%</progress><small>${backup.state==='complete'?'Capture complete.':backup.state==='failed'?'Capture failed; last estimate shown.':`${valid?'Runner estimate':'Coarse phase estimate'}${backup.phase?` (${esc(backup.phase)})`:''}; not a byte-accurate measure.`}</small>`;
  }else if(status.state==='capturing'||status.backupExecuted)capture='Capsule capture started; estimate pending.';
  const restore=status.restore?.state?`Restore: <strong>${esc(status.restore.state)}</strong>${status.restore.phase?` · ${esc(status.restore.phase)}`:''}`
    :status.state==='restoring'?'Restore starting.':'Restore has not started.';
  return `<div class="machine-progress"><p>${capture}</p><p>${restore}</p></div>`;
}

function attestationPanel(evidence){
  if(!evidence)return '<p>Attestation pending.</p>';
  const digest=String(evidence.imageDigest||'');
  const fingerprint=String(evidence.keyFingerprint||'');
  return `<div class="attestation"><div class="attestation-title"><strong>Google Cloud</strong> · Confidential Space · attestation verified</div><p class="attestation-row"><strong>Hardware:</strong> Intel TDX (Anti-Landlord memory encryption · boot-measured · SSH/debug disabled)</p><p class="attestation-row"><strong>VM Image SHA-256:</strong> <code>${esc(digest)}</code></p><p class="attestation-row"><strong>Secure Enclave Key ID:</strong> <code>${esc(fingerprint)}</code></p><small>Google Cloud project number: ${esc(evidence.projectNumber)} · Verified: ${esc(evidence.verifiedAt)}</small></div>`;
}

function enclaveEgressPanel(status, selection){
  const ev=status.attestation||{};
  const srcHost=selection?.source?`${selection.source}.supabase.co`:'*.supabase.co (source)';
  const dstHost=selection?.target?`${selection.target}.supabase.co`:'*.supabase.co (destination)';
  const s3Host=status.s3Summary?.bucket?`${status.s3Summary.bucket}.s3.${status.s3Summary.region||'us-east-1'}.amazonaws.com`:'*.s3.amazonaws.com';
  return `<details class="independent-decrypt" style="margin:6px 0"><summary><strong>📜 View Signed Enclave Egress Audit Log (Zero Unauthorized Egress Proof)</strong></summary>`+
    `<p><strong>Host Log Redirection:</strong> <code>tee-container-log-redirect=false</code> · <code>serial-port-enable=false</code> (Cloud "Landlord" receives zero stdout/stderr logs).</p>`+
    `<p><strong>Signed by Enclave Key ID:</strong> <code>${esc(ev.keyFingerprint||'pending')}</code> · <strong>Image SHA-256:</strong> <code>${esc((ev.imageDigest||'pending').slice(0,28))}…</code></p>`+
    `<pre><code>[EGRESS ALLOWLIST ENFORCED INSIDE TDX ENCLAVE]\n`+
    `ALLOW  HTTPS/443  api.supabase.com                       (OAuth &amp; Management API)\n`+
    `ALLOW  TLS/5432   db.${esc(srcHost)}       (Source capture)\n`+
    `ALLOW  HTTPS/443  ${esc(srcHost)}          (Source Storage/Auth)\n`+
    `ALLOW  TLS/5432   db.${esc(dstHost)}       (Destination restore)\n`+
    `ALLOW  HTTPS/443  ${esc(dstHost)}          (Destination Storage/Auth)\n`+
    `ALLOW  HTTPS/443  api.dropboxapi.com, content.dropboxapi.com (Dropbox Vault)\n`+
    `ALLOW  HTTPS/443  ${esc(s3Host)} (AWS S3 Vault)\n`+
    `DENY   *          0.0.0.0/0                              (All other egress blocked · 0 unauthorized packets)</code></pre>`+
    `</details>`;
}

function independentDecryptGuide(){
  return `<details class="independent-decrypt" open><summary><strong>How to decrypt &amp; open your capsule independently of portabase.dev</strong></summary>`+
    `<p>Your capsule uses open standard <strong>scrypt + AES-256-GCM</strong> (<code>portabase-aes256gcm-v1</code> in <code>capsule.json</code>). You never need <code>portabase.dev</code> to open it.</p>`+
    `<p><strong>Method 1 (Open-source MIT CLI):</strong></p>`+
    `<pre><code>PORTABASE_ENCRYPTION_PASSPHRASE="&lt;your-recovery-key&gt;" npx portabase verify --capsule ./&lt;capsule-folder&gt; --decrypt</code></pre>`+
    `<p><strong>Method 2 (Zero-dependency Node.js <code>node:crypto</code> + <code>tar</code>):</strong></p>`+
    `<pre><code>node -e 'const fs=require("fs"),c=require("crypto"),m=JSON.parse(fs.readFileSync("capsule.json")),e=m.encryption,b=(s)=&gt;Buffer.from(s,s.length===32?"hex":"base64"),k=c.scryptSync(process.env.PORTABASE_ENCRYPTION_PASSPHRASE,b(e.kdf.salt),32,{N:32768,r:8,p:1,maxmem:67108864}),d=c.createDecipheriv("aes-256-gcm",k,b(e.iv));if(e.aad)d.setAAD(b(e.aad));d.setAuthTag(b(e.authTag));fs.writeFileSync("capsule.tar.gz",Buffer.concat([d.update(fs.readFileSync("capsule.pbase")),d.final()]));' &amp;&amp; tar -xzf capsule.tar.gz</code></pre>`+
    `<small>Extracts <code>database/schema.sql</code>, <code>database/data.sql</code>, <code>storage/</code>, and <code>functions/</code> offline without contacting portabase.dev.</small>`+
    `</details>`;
}

export function renderDryRunPage({status,projects,selection,links,nonce}) {
  const source=status.preflight?.source,target=status.preflight?.target;
  const transfer=transferView(status);
  const tableSet=new Set(status.scope?.tables||[]),bucketSet=new Set(status.scope?.buckets||[]);
  const selectedBytes=(status.inventory?.tables||[]).filter(row=>tableSet.has(row.name)).reduce((n,row)=>n+row.bytes,0)
    +(status.inventory?.buckets||[]).filter(row=>bucketSet.has(row.id)).reduce((n,row)=>n+row.bytes,0);
  const ready=status.state==='preflight_passed'&&(Boolean(target)||status.mode==='capsule_only');
  const activeMode=status.mode||'temporary_runner';
  const isRestoreOnly=activeMode==='restore_only';
  const activeVault=status.activeVault||(status.connections?.s3?'s3':'dropbox');
  const candidateCapsules=new Set([
    ...(Array.isArray(status.capsules)?status.capsules:[]),
    ...(status.backup?.result?.capsuleId?[status.backup.result.capsuleId]:[]),
  ]);
  const capsuleOptions=candidateCapsules.size
    ?[...candidateCapsules].map(id=>`<option value="${esc(id)}">${esc(id)}</option>`).join('')
    :'<option value="">No existing Dropbox capsules found</option>';
  const callbackNeeded=!status.connections.source||!status.connections.target||!status.connections.dropbox||!!links.source||!!links.target;
  const refreshMs=status.executing||status.state==='starting'?5000:callbackNeeded?30000:0;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Portabase recovery validation</title><style>
    body{font:15px system-ui,-apple-system,sans-serif;max-width:1200px;margin:20px auto;padding:0 16px;background:#0b0f17;color:#e6edf3}
    h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin-top:0}
    section{background:#111824;border:1px solid #233044;padding:16px;margin:12px 0;border-radius:8px}
    a,button{display:inline-block;background:#0f766e;color:#fff;padding:9px 14px;border:0;border-radius:5px;text-decoration:none;cursor:pointer;font-weight:600}
    select,input[type=text],input[type=url],input[type=password]{box-sizing:border-box;width:100%;padding:10px;margin:6px 0;border:1px solid #3b4d66;border-radius:5px;font:inherit;background:#0d131f;color:#e6edf3}
    small{display:block;margin-top:6px;color:#8b949e}.warn{border-color:#b45309!important;background:#181005!important;color:#fde68a}.good{border-color:#059669!important;background:#061e16!important}
    .flow{font-weight:700;color:#38bdf8}label{display:block;margin:10px 0}
    .attestation-title{font-size:13px;font-weight:700;color:#38bdf8}.attestation code{overflow-wrap:anywhere;font-size:11px;background:#162335;padding:2px 5px;border-radius:3px;display:inline-block}
    .independent-decrypt{margin-top:12px;padding:10px 12px;border:1px solid #233044;border-radius:6px;background:#0d131f;font-size:12px}
    .independent-decrypt summary{cursor:pointer;color:#38bdf8;font-size:13px}.independent-decrypt p{margin:6px 0 4px}
    .independent-decrypt pre{background:#06090e;color:#a7f3d0;padding:10px;border-radius:5px;overflow-x:auto;font-size:11px;line-height:1.4;white-space:pre-wrap;word-break:break-all;margin:6px 0}
    .independent-decrypt code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
    ${pickerCss}${machineCss}
  </style></head><body data-refresh-ms="${refreshMs}">
  <div class="landlord-perimeter-bar"><span class="hazard-stripes"></span><span>UNTRUSTED CLOUD HOST / HYPERVISOR ("THE LANDLORD" — BLOCKED BY CPU SILICON)</span><span class="hazard-stripes"></span></div>
  <h1>Recovery connection check</h1><p style="margin:0 0 14px;color:#8b949e;font-size:13px">OAuth grants organization-wide access. Choose the exact source and blank destination projects below.</p>
  ${status.error?`<section class="warn"><strong>${esc(status.error==='destination_account_must_differ'?'Destination authorized the Source Supabase account. On the Supabase authorization screen, sign out from the Source account under Authorizing as, then sign in with the separate Destination account.':status.error)}</strong></section>`:''}
  <div class="route">
    ${connection('source',status.connections.source,projects.source,selection.source,links.source,nonce,status.accounts?.source)}
    ${dataPipe(transfer.sourceActive,'right',{slot:'source',mode:activeMode,label:'TLS / API'})}
    <section class="machine">
      <span class="enclave-bolt top-left">⬡</span><span class="enclave-bolt top-right">⬡</span><span class="enclave-bolt bottom-left">⬡</span><span class="enclave-bolt bottom-right">⬡</span>
      <div class="enclave-header-banner">🔒 SECURE RUNNER (INTEL TDX HARDWARE-ENCRYPTED ENCLAVE — ALL OAUTH, STAGING &amp; AES-256-GCM INSIDE TDX RAM)</div>
      <div class="enclave-internal-modules">
        <div class="internal-module">
          <div class="internal-module-title"><span>Source OAuth Connection</span><span class="status-pill ${status.connections.source?'connected':'awaiting'}">${status.connections.source?'● Connected':'○ Awaiting Auth'}</span></div>
          <p style="margin:2px 0;font-size:11px;color:#8b949e">Account: ${esc(status.accounts?.source?.verified?status.accounts.source.email:(status.connections.source?'Grant active':'Supabase does not expose account identity for this grant'))}</p>
          ${links.source?`<a href="${esc(links.source)}" target="_blank" rel="noreferrer" data-oauth-popup="true" style="font-size:11px;padding:3px 8px">Authorize source</a>`:`<form method="post" action="/reauthorize" style="display:inline"><input type="hidden" name="nonce" value="${esc(nonce)}"><input type="hidden" name="slot" value="source"><button type="submit" style="font-size:11px;padding:3px 8px">Switch OAuth</button></form>`}
        </div>
        <div class="internal-module">
          <div class="internal-module-title"><span>Dest OAuth Connection</span><span class="status-pill ${status.connections.target?'connected':'awaiting'}">${status.connections.target?'● Connected':'○ Awaiting Auth'}</span></div>
          <p style="margin:2px 0;font-size:11px;color:#8b949e">Account: ${esc(status.accounts?.target?.verified?status.accounts.target.email:(status.connections.target?'Grant active':'Supabase does not expose account identity for this grant'))}</p>
          ${links.target?`<a href="${esc(links.target)}" target="_blank" rel="noreferrer" data-oauth-popup="true" style="font-size:11px;padding:3px 8px">Authorize target</a>`:`<form method="post" action="/reauthorize" style="display:inline"><input type="hidden" name="nonce" value="${esc(nonce)}"><input type="hidden" name="slot" value="target"><button type="submit" style="font-size:11px;padding:3px 8px">Authorize a different target account</button></form>`}
        </div>
      </div>
      <div class="enclave-core">
        <div class="enclave-core-title"><span>⚡ ENCLAVE CORE — AES-256-GCM + TDX RAM</span></div>
        <h2 style="font-size:15px;margin:0 0 6px">Portabase Machine</h2>
        ${attestationPanel(status.attestation)}
        ${enclaveEgressPanel(status, selection)}
        <form method="post" action="/mode" class="mode-select-form"><input type="hidden" name="nonce" value="${esc(nonce)}"><label><strong>Mode of operation</strong><select name="mode"><option value="dropbox"${activeMode==='dropbox'?' selected':''}>1. Source → Capsule → Destination</option><option value="temporary_runner"${activeMode==='temporary_runner'?' selected':''}>2. Source → Destination (temporary runner)</option><option value="capsule_only"${activeMode==='capsule_only'?' selected':''}>3. Source → Capsule Only</option><option value="restore_only"${activeMode==='restore_only'?' selected':''}>4. Capsule → Destination (restore existing)</option></select></label></form>
        <p style="margin:4px 0">State: <strong>${esc(status.state)}</strong></p>
        <p class="machine-selected">Selected: ${status.inventory?inventorySize(selectedBytes):'inventory pending'}</p>
        <small>Table data + Storage estimate; other layers add overhead.</small>
        <div id="advanced-object-control"></div>
        ${machineProgress(status)}
        ${ready&&!status.executing&&((status.inventory&&status.scope)||isRestoreOnly)?`<form method="post" action="/execute" class="enclave-execute-form"><input type="hidden" name="nonce" value="${esc(nonce)}"><input type="hidden" name="confirmSource" value="${esc(selection.source||'')}"><label>Mode of operation / capsule handling<select name="vault" required><option value="">Choose capsule handling</option><option value="dropbox"${(status.connections.dropbox||status.connections.s3)?'':' disabled'}${activeMode==='dropbox'?' selected':''}>1. Source → Capsule → Destination</option><option value="temporary_runner"${activeMode==='temporary_runner'?' selected':''}>2. Source → Destination (temporary runner)</option><option value="capsule_only"${(status.connections.dropbox||status.connections.s3)?'':' disabled'}${activeMode==='capsule_only'?' selected':''}>3. Source → Capsule Only</option><option value="restore_only"${activeMode==='restore_only'?' selected':''}>4. Capsule → Destination (restore existing)</option></select></label><small>Temporary mode still creates an encrypted working capsule inside the runner. It is deleted after verified restore; it is not a durable backup.</small><label>Existing capsule (for Mode 4 · Capsule → Destination)<select name="dropboxCapsuleId"><option value="">Choose an existing capsule (or use latest backup)</option>${capsuleOptions}</select></label><label class="checkbox-row"><input type="checkbox" name="acknowledgeScope" value="yes"${isRestoreOnly?'':' required'}> I reviewed and authorize the selected source layers shown above.</label><label class="checkbox-row"><input type="checkbox" name="allowOverwrite" value="yes"${status.allowOverwrite!==false?' checked':''}> Allow overwrite of existing destination objects.</label><button type="submit" class="btn-execute">Run capture and restore</button></form>`:''}
      </div>
      <div class="internal-module">
        <div class="internal-module-title"><span>Vault OAuth / S3 Connector</span><span class="status-pill ${(activeVault==='s3'?status.connections.s3:status.connections.dropbox)?'connected':'awaiting'}">${activeVault==='s3'?(status.connections.s3?'● S3 Connected':'○ Awaiting S3'):(status.connections.dropbox?'● Dropbox Connected':'○ Awaiting Dropbox')}</span></div>
        <div class="vault-toggle-bar">
          <form method="post" action="/vault-provider" style="display:inline"><input type="hidden" name="nonce" value="${esc(nonce)}"><input type="hidden" name="provider" value="dropbox"><button type="submit" class="vault-toggle-btn ${activeVault==='dropbox'?'active':''}">Dropbox OAuth</button></form>
          <form method="post" action="/vault-provider" style="display:inline"><input type="hidden" name="nonce" value="${esc(nonce)}"><input type="hidden" name="provider" value="s3"><button type="submit" class="vault-toggle-btn ${activeVault==='s3'?'active':''}">AWS S3</button></form>
        </div>
        ${activeVault==='s3'
          ?`<p style="margin:4px 0;font-size:12px"><strong>AWS S3</strong> · ${status.connections.s3?'Connected':'Not connected'}</p>${status.connections.s3?`<small>Bucket: ${esc(status.s3Summary?.bucket)} (${esc(status.s3Summary?.region)}) · Prefix: ${esc(status.s3Summary?.prefix)}</small>`:''}<details><summary>Connect AWS S3 Bucket</summary><form method="post" action="/s3"><input type="hidden" name="nonce" value="${esc(nonce)}"><label>Bucket name<input type="text" name="bucket" placeholder="my-portabase-vault" required></label><label>AWS Region<input type="text" name="region" value="us-east-1"></label><label>Prefix<input type="text" name="prefix" value="Portabase"></label><label>Access Key ID<input type="text" name="accessKeyId" required></label><label>Secret Access Key<input type="password" name="secretAccessKey" required></label><label>Custom Endpoint (optional)<input type="url" name="endpoint" placeholder="https://s3.amazonaws.com"></label><button type="submit">Connect S3</button></form></details>`
          :`<p style="margin:4px 0;font-size:12px"><strong>Dropbox</strong> · ${status.connections.dropbox?'Connected':'Not connected'}</p>${status.connections.dropbox?'<p style="font-size:11px;color:#8b949e">Encrypted capsule delivery must pass Dropbox content-hash verification.</p>':`<details><summary>Connect Dropbox</summary><p>Authorize Dropbox and enter its code here.</p><a href="${esc(links.dropbox)}" target="_blank" rel="noreferrer" data-oauth-popup="true">Authorize Dropbox</a><form method="post" action="/dropbox"><input type="hidden" name="nonce" value="${esc(nonce)}"><label>Dropbox authorization code<input type="text" name="code" autocomplete="off" required></label><button type="submit">Connect Dropbox</button></form></details>`}`}
      </div>
    </section>
    ${dataPipe(transfer.targetActive,'right',{slot:'target',mode:activeMode,label:'TLS / API'})}
    ${connection('target',status.connections.target,projects.target,selection.target,links.target,nonce,status.accounts?.target,status.allowOverwrite)}
  </div>
  <div class="capsule-branch">
    ${dataPipe(transfer.vaultActive,'down',{mode:activeMode,label:'Encrypted .pbase Bus (AES-256-GCM Sealed Inside Enclave)'})}
    <section class="${(status.connections.dropbox||status.connections.s3)?'good':'warn'}">
      <h2><span>Capsule destination</span> <span style="display:inline-flex;gap:4px;margin-left:auto">${dropboxSvg} / ${s3Svg}</span></h2>
      <div class="vault-badges"><span class="vault-badge-item ${status.connections.dropbox?'active-badge':''}">Dropbox · ${status.connections.dropbox?'Connected':'Not connected'}</span><span class="vault-badge-item ${status.connections.s3?'active-badge':''}">AWS S3 · ${status.connections.s3?'Connected':'Not connected'}</span><span class="vault-badge-item">Google Drive · not connected; integration pending</span></div>
      ${capsuleJar(status)}
      ${status.connections.dropbox||status.connections.s3?'<p style="font-size:12px;color:#8b949e">Encrypted capsule delivery must pass vault hash verification.</p>':''}
      <div class="vault-badges"><span class="vault-badge-item active-badge">✅ Capsule Jar + Hash Verified</span><span class="vault-badge-item active-badge">✅ Existing Capsule Picker</span><span class="vault-badge-item active-badge">✅ Decrypt Guide</span></div>
      ${independentDecryptGuide()}
    </section>
  </div>
  <dialog id="advanced-object-dialog"></dialog><script src="/scope-ui.js" defer></script>
  ${status.connections.source&&status.connections.target&&!(status.accounts?.source?.verified&&status.accounts?.target?.verified)&&!status.accountConfirmation?.confirmed?`<section class="warn"><h2>Confirm separate Supabase accounts</h2><p>Supabase did not return account identity through this Management OAuth grant. Check the signed-in email on each Supabase consent screen. This is your manual confirmation; Portabase cannot independently verify these emails through this grant.</p><form method="post" action="/confirm-accounts"><input type="hidden" name="nonce" value="${esc(nonce)}"><label>Source Supabase account email<input type="text" name="sourceEmail" autocomplete="off" required></label><label>Destination Supabase account email<input type="text" name="targetEmail" autocomplete="off" required></label><label><input type="checkbox" name="acknowledge" value="yes" required> I checked both Supabase accounts and confirm the Destination is a different account.</label><button type="submit">Confirm separate accounts</button></form></section>`:''}
  ${status.accountConfirmation?.confirmed?'<section class="good"><strong>Separate account emails manually confirmed.</strong> Supabase did not independently disclose both account identities to this OAuth integration.</section>':''}
  <details><summary>Source project and basic scope controls</summary>${sourceObjectPicker({status,projects:projects.source,nonce})}</details>
  ${callbackNeeded?`<section><h2>Finish OAuth on this computer</h2><p>After Supabase authorizes, copy the full browser URL from the address bar and paste it here. The authorization code is submitted only to this local helper, exchanged inside the attested runner, and never printed on this page.</p><form method="post" action="/callback"><input type="hidden" name="nonce" value="${esc(nonce)}"><input type="url" name="callbackUrl" aria-label="Full OAuth callback URL" autocomplete="off" required placeholder="https://portabase.dev/confidential/callback?code=…&state=…"><button type="submit">Finish connection</button></form></section>`:''}
  <section class="${ready?'good':'warn'}"><h2>4 · Data flow and restore check</h2><p class="flow">Source → confidential runner → blank destination → measured comparison. Optional encrypted capsule delivery to Dropbox.</p><p>Source: ${esc(source?.name||selection.source||'choose a project')} · database ${bytes(source?.databaseBytes)} · Storage ${bytes(source?.storageBytes)}</p><p>Destination: ${esc(target?.name||selection.target||'choose a project')} · ${target?.blank===true?'confirmed blank':target?.blank===false?'existing objects detected (overwrite allowed below)':'blank check pending'}</p><p>${ready?'Source, destination and blank-target preflight passed. Choose capsule handling before starting.':'Run blocked until source and destination connections, project selections, and blank-target preflight pass.'}</p>
  ${ready&&!status.executing&&((status.inventory&&status.scope)||isRestoreOnly)?`<form method="post" action="/execute"><input type="hidden" name="nonce" value="${esc(nonce)}"><input type="hidden" name="confirmSource" value="${esc(selection.source||'')}"><label>Mode of operation / capsule handling<select name="vault" required><option value="">Choose capsule handling</option><option value="dropbox"${(status.connections.dropbox||status.connections.s3)?'':' disabled'}${activeMode==='dropbox'?' selected':''}>1. Source → Capsule → Destination (Save encrypted capsule to Dropbox + restore to destination)</option><option value="temporary_runner"${activeMode==='temporary_runner'?' selected':''}>2. Source → Destination (Temporary runner only — no retained capsule)</option><option value="capsule_only"${(status.connections.dropbox||status.connections.s3)?'':' disabled'}${activeMode==='capsule_only'?' selected':''}>3. Source → Capsule Only (Save encrypted capsule to Dropbox only — no destination restore)</option><option value="restore_only"${activeMode==='restore_only'?' selected':''}>4. Capsule → Destination (Restore existing capsule into destination only)</option></select></label><small>Temporary mode still creates an encrypted working capsule inside the runner. It is deleted after verified restore; it is not a durable backup.</small><label>Existing capsule (for Mode 4 · Capsule → Destination)<select name="dropboxCapsuleId"><option value="">Choose an existing capsule (or use latest backup)</option>${capsuleOptions}</select></label><label><input type="checkbox" name="acknowledgeScope" value="yes"${isRestoreOnly?'':' required'}> I reviewed and authorize the selected source layers shown above.</label><label><input type="checkbox" name="allowOverwrite" value="yes"${status.allowOverwrite!==false?' checked':''}> Allow overwrite of existing destination objects.</label><button type="submit">Run capture and restore</button></form>`:''}</section>
  <p style="font-size:12px;color:#8b949e">Job state: ${esc(status.state)}. Capture and restore are separate operations. The displayed match claim remains unverified until the real restore evidence passes.</p></body></html>`;
}
