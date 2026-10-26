import {sourceObjectPicker,pickerCss} from './source-object-picker.mjs';
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
function connection(slot,connected,projects,selected,link,nonce,account) {
  const label=slot==='source'?'Source Supabase':'Destination Supabase';
  const guidance=slot==='target'?'<p><strong>Use your separate destination Supabase account.</strong> On the Supabase authorization screen, check the <em>Authorizing as</em> email. If it shows your Source account, click <em>Sign out</em> there, then sign in with the Destination account before approving.</p>':'';
  if(!connected)return `<section class="connection"><h2>${label}</h2>${guidance}<p>Authorize Supabase to inspect projects for this connection.</p><a href="${esc(link)}" target="_blank" rel="noreferrer">Authorize ${slot}</a></section>`;
  if(slot==='source')return `<section class="connection"><h2>${label}</h2><p>Authorized account: <strong>${esc(account?.verified?account.email:'Supabase does not expose account identity for this grant')}</strong></p><p>Choose the Source project and its database objects in the picker below.</p><form method="post" action="/reauthorize"><input type="hidden" name="nonce" value="${esc(nonce)}"><input type="hidden" name="slot" value="source"><button type="submit">Authorize a different source account</button></form>${link?`<p>New authorization link: <a href="${esc(link)}" target="_blank" rel="noreferrer">Open Supabase authorization</a></p>`:''}<small>${esc(projects.length)} project(s) available through this grant.</small></section>`;
  const options=projects.map(p=>`<option value="${esc(p.ref)}"${p.ref===selected?' selected':''}>${esc(p.name)} (${esc(p.ref)})</option>`).join('');
  return `<section class="connection"><h2>${label}</h2><p>Authorized account: <strong>${esc(account?.verified?account.email:'Supabase does not expose account identity for this grant')}</strong></p>${guidance}<p>Choose the ${slot==='source'?'project to read':'blank project to restore into'}.</p><form method="post" action="/select"><input type="hidden" name="nonce" value="${esc(nonce)}"><input type="hidden" name="slot" value="${slot}"><select name="ref" required><option value="">Choose a project</option>${options}</select><button type="submit">Check ${slot}</button></form><form method="post" action="/reauthorize"><input type="hidden" name="nonce" value="${esc(nonce)}"><input type="hidden" name="slot" value="${slot}"><button type="submit">Authorize a different ${slot} account</button></form>${link?`<p>New authorization link: <a href="${esc(link)}" target="_blank" rel="noreferrer">Open Supabase account chooser</a></p>`:''}<small>${esc(projects.length)} project(s) available through this grant.</small></section>`;
}
function machineProgress(status) {
  const backup=status.backup;
  let capture='No capsule capture has started.';
  if(backup){
    const raw=Number(backup.estimatedPercent);
    const valid=backup.progressKind==='estimate'&&Number.isInteger(raw)&&raw>=0;
    // Older, already running images report only the current phase. This is a
    // coarse fallback for this session; it does not imply bytes transferred.
    const phaseEstimate={'preflight':0,'database-manifest':2,database:5,storage:45,functions:78,
      package:85,encrypt:91,transfer:96,done:99}[backup.phase];
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
  return `<div class="attestation"><strong>Google Cloud</strong><span>Confidential Space · attestation verified</span><small>Verified workload image: <code>${esc(digest.slice(0,19))}…${esc(digest.slice(-12))}</code></small><details><summary>View full verification hashes</summary><p>Image SHA-256: <code>${esc(digest)}</code></p><p>Attested key fingerprint: <code>${esc(fingerprint)}</code></p><small>Google Cloud project number: ${esc(evidence.projectNumber)} · Verified: ${esc(evidence.verifiedAt)}</small></details></div>`;
}
export function renderDryRunPage({status,projects,selection,links,nonce}) {
  const source=status.preflight?.source,target=status.preflight?.target;
  const ready=status.state==='preflight_passed'&&target?.blank===true&&status.connections.dropbox===true;
  const callbackNeeded=!status.connections.source||!status.connections.target||!status.connections.dropbox||!!links.source||!!links.target;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Portabase recovery validation</title>${status.executing?'<meta http-equiv="refresh" content="5">':callbackNeeded?'<meta http-equiv="refresh" content="30">':''}<style>
    body{font:16px system-ui;max-width:1100px;margin:32px auto;padding:0 18px;background:#f3f8f6;color:#17352c}h1{font-size:30px}h2{font-size:20px;margin-top:0}section{background:white;border:1px solid #cadbd2;padding:20px;margin:14px 0;border-radius:8px}a,button{display:inline-block;background:#006c58;color:white;padding:11px 16px;border:0;border-radius:5px;text-decoration:none;cursor:pointer}select,input[type=text],input[type=url]{box-sizing:border-box;width:100%;padding:12px;margin:9px 0;border:1px solid #9db8aa;border-radius:5px;font:inherit}small{display:block;margin-top:8px;color:#526c5e}.warn{border-color:#c86e40;background:#fff8f1}.good{border-color:#2f9d71}.flow{font-weight:700;color:#075f4d}label{display:block;margin:12px 0}.route{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr);gap:14px;align-items:stretch}.route section{min-width:0}.machine{border-color:#6bbba5;background:#ecfaf4}.machine-progress progress{width:100%;height:20px;accent-color:#007b63}.vaults{display:flex;flex-wrap:wrap;gap:8px}.vaults span{border:1px solid #cadbd2;padding:8px;border-radius:5px;background:#f6faf8}.scope{border-color:#72b8a5}.scope-columns{display:grid;grid-template-columns:1.2fr 1fr;gap:24px}.scope-group{border:1px solid #dce8e2;border-radius:6px;padding:10px;margin:9px 0}.scope-group summary{font-weight:700;cursor:pointer}.scope-group summary small{display:inline;margin-left:8px}.object-row{display:grid;grid-template-columns:20px minmax(100px,1fr) auto;align-items:center;gap:8px;border-bottom:1px solid #edf2ef;padding:8px 2px;margin:0}.object-row input{width:18px;height:18px;margin:0;accent-color:#007b63}.object-row small{margin:0}.object-row em{grid-column:2/4;color:#9a5625;font-size:12px;font-style:normal}.scope-estimate{padding:10px;background:#ecfaf4}.scope-note{padding:10px;background:#fff8f1;border-left:3px solid #c86e40}@media(max-width:820px){.route,.scope-columns{grid-template-columns:1fr}}
    .attestation{display:grid;gap:5px;padding:12px;border:1px solid #72b8a5;background:white;border-radius:6px}.attestation strong{font-size:20px}.attestation code{overflow-wrap:anywhere;font-size:12px}.attestation details{margin-top:6px}.attestation summary{cursor:pointer;font-size:13px}
    ${pickerCss}
  </style></head><body><h1>Recovery connection check</h1><p>OAuth grants organization-wide access. Choose the exact source and blank destination projects below.</p>
  ${status.error?`<section class="warn"><strong>${esc(status.error==='destination_account_must_differ'?'Destination authorized the Source Supabase account. On the Supabase authorization screen, sign out from the Source account under Authorizing as, then sign in with the separate Destination account.':status.error)}</strong></section>`:''}
  <div class="route">${connection('source',status.connections.source,projects.source,selection.source,links.source,nonce,status.accounts?.source)}
  <section class="machine"><h2>Portabase Machine</h2>${attestationPanel(status.attestation)}<p>State: <strong>${esc(status.state)}</strong></p>${machineProgress(status)}</section>
  ${connection('target',status.connections.target,projects.target,selection.target,links.target,nonce,status.accounts?.target)}</div>
  ${status.connections.source&&status.connections.target&&!(status.accounts?.source?.verified&&status.accounts?.target?.verified)&&!status.accountConfirmation?.confirmed?`<section class="warn"><h2>Confirm separate Supabase accounts</h2><p>Supabase did not return account identity through this Management OAuth grant. Check the signed-in email on each Supabase consent screen. This is your manual confirmation; Portabase cannot independently verify these emails through this grant.</p><form method="post" action="/confirm-accounts"><input type="hidden" name="nonce" value="${esc(nonce)}"><label>Source Supabase account email<input type="text" name="sourceEmail" autocomplete="off" required></label><label>Destination Supabase account email<input type="text" name="targetEmail" autocomplete="off" required></label><label><input type="checkbox" name="acknowledge" value="yes" required> I checked both Supabase accounts and confirm the Destination is a different account.</label><button type="submit">Confirm separate accounts</button></form></section>`:''}
  ${status.accountConfirmation?.confirmed?'<section class="good"><strong>Separate account emails manually confirmed.</strong> Supabase did not independently disclose both account identities to this OAuth integration.</section>':''}
  ${sourceObjectPicker({status,projects:projects.source,nonce})}
  ${callbackNeeded?`<section><h2>Finish OAuth on this computer</h2><p>After Supabase authorizes, copy the full browser URL from the address bar and paste it here. The authorization code is submitted only to this local helper, exchanged inside the attested runner, and never printed on this page.</p><form method="post" action="/callback"><input type="hidden" name="nonce" value="${esc(nonce)}"><input type="url" name="callbackUrl" aria-label="Full OAuth callback URL" autocomplete="off" required placeholder="https://portabase.dev/confidential/callback?code=…&state=…"><button type="submit">Finish connection</button></form></section>`:''}
  <section class="${status.connections.dropbox?'good':'warn'}"><h2>Capsule destination · Dropbox</h2>${status.connections.dropbox
    ?'<p>Dropbox OAuth connected. The run will upload the encrypted capsule and check Dropbox content hashes before restore.</p>'
    :`<p>Authorize Dropbox, then copy the code shown by Dropbox into this form. The code is sent only to this local helper and exchanged inside the attested runner.</p><a href="${esc(links.dropbox)}" target="_blank" rel="noreferrer">Authorize Dropbox</a><form method="post" action="/dropbox"><input type="hidden" name="nonce" value="${esc(nonce)}"><label>Dropbox authorization code<input type="text" name="code" autocomplete="off" required></label><button type="submit">Connect Dropbox</button></form>`}</section>
  <section class="${ready?'good':'warn'}"><h2>4 · Data flow and restore check</h2><p class="flow">Source → confidential runner → encrypted capsule → Dropbox; runner capsule → blank destination → measured comparison</p><p>Source: ${esc(source?.name||selection.source||'choose a project')} · database ${bytes(source?.databaseBytes)} · Storage ${bytes(source?.storageBytes)}</p><p>Destination: ${esc(target?.name||selection.target||'choose a project')} · ${target?.blank===true?'confirmed blank':target?.blank===false?'NOT BLANK — run blocked':'blank check pending'}</p><p>${ready?'All three connections and blank-target preflight passed.':'Run blocked until source, destination and Dropbox OAuth connections, project selections, and blank-target preflight pass.'}</p>
  ${ready&&!status.executing&&status.inventory&&status.scope?`<form method="post" action="/execute"><input type="hidden" name="nonce" value="${esc(nonce)}"><input type="hidden" name="confirmSource" value="${esc(selection.source)}"><label>Type destination project ref to confirm restore<input type="text" name="confirmTarget" required autocomplete="off" placeholder="${esc(selection.target)}"></label><label><input type="checkbox" name="acknowledgeScope" value="yes" required> I reviewed and authorize the selected source layers shown above.</label><label><input type="checkbox" name="acknowledgeBlankTarget" value="yes" required> I authorize restoring only into the confirmed blank destination.</label><button type="submit">Run capture and restore</button></form>`:''}</section>
  <p>Job state: ${esc(status.state)}. Capture and restore are separate operations. The displayed match claim remains unverified until the real restore evidence passes.</p></body></html>`;
}
