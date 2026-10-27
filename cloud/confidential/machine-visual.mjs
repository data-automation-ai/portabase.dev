const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function transferView(status) {
  const backup = status.backup, restore = status.restore;
  const failed = Boolean(status.error) || ['drill_failed', 'paused'].includes(status.state);
  const running = job => !failed && status.executing === true && job?.state === 'running';
  const delivery = backup?.delivery;
  const known = Number.isSafeInteger(delivery?.bytesReceived) && Number.isSafeInteger(delivery?.totalBytes)
    && delivery.totalBytes > 0 && delivery.bytesReceived >= 0 && delivery.bytesReceived <= delivery.totalBytes;
  const verified = backup?.state === 'complete' && backup.result?.vaultVerified === true;
  return {
    sourceActive: running(backup) && ['database-manifest', 'database', 'storage', 'functions'].includes(backup.phase),
    targetActive: running(restore),
    vaultActive: running(backup) && backup.phase === 'transfer',
    percent: verified ? 100 : known ? Math.min(99, 100 * delivery.bytesReceived / delivery.totalBytes) : null,
    label: verified ? 'Capsule delivered and verified' : known ? 'Bytes received; verification pending' :
      running(backup) && backup.phase === 'transfer' ? 'Uploading · byte count unavailable' : 'No measured capsule delivery yet',
  };
}

export function dataPipe(active, direction = 'right', opts = {}) {
  const mode = opts.mode || 'temporary_runner';
  const label = opts.label || (direction === 'down' ? 'Encrypted .pbase Bus' : 'TLS / API');
  const isDimmed = opts.dimmed ?? (
    (direction === 'right' && opts.slot === 'source' && mode === 'restore_only') ||
    (direction === 'right' && opts.slot === 'target' && mode === 'capsule_only') ||
    (direction === 'down' && mode === 'temporary_runner')
  );
  const isReverse = opts.reverse ?? (direction === 'down' && mode === 'restore_only');
  const flowClass = isReverse ? 'flow-reverse' : 'flow-forward';
  const dimClass = isDimmed ? 'pipe-dimmed' : '';
  const dirClass = direction === 'down' ? 'down' : direction;

  return `<div aria-label="${active ? 'Transfer active' : 'Transfer idle'}" class="data-pipe ${dirClass} ${active ? 'active' : ''} ${flowClass} ${dimClass}"><span class="pipe-label">${esc(label)}</span><svg class="pipe-svg" preserveAspectRatio="none"><line x1="0" y1="50%" x2="100%" y2="50%" class="pipe-track"/><line x1="0" y1="50%" x2="100%" y2="50%" class="pipe-flow"/></svg><i></i><i></i><i></i></div>`;
}

export function capsuleJar(status) {
  const view = transferView(status);
  return `<div class="capsule-display"><div class="capsule-jar ${view.vaultActive ? 'active' : ''}" role="img" aria-label="${esc(view.label)}${view.percent === null ? '' : ` · ${Math.floor(view.percent)} percent`}"><div class="capsule-water" style="height:${view.percent ?? 0}%"></div><strong>${view.percent === null ? '—' : `${Math.floor(view.percent)}%`}</strong></div><p class="capsule-label-text">${esc(view.label)}</p></div>`;
}

export const machineCss = `
:root{--bg-deep:#0b0f17;--bg-card:#111824;--bg-elevated:#162032;--border-subtle:#233044;--border-bold:#3b4d66;--text-main:#e6edf3;--text-muted:#8b949e;--accent-green:#00dc82;--accent-cyan:#38bdf8;--accent-amber:#f59e0b;--accent-red:#f87171}
body{background:var(--bg-deep)!important;color:var(--text-main)!important;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}
.landlord-perimeter-bar{display:flex;align-items:center;justify-content:center;gap:12px;padding:6px 12px;margin:0 0 16px 0;background:#181005;border:1px solid #78350f;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:1px;color:#fbbf24;text-transform:uppercase}
.hazard-stripes{display:inline-block;width:32px;height:10px;background:repeating-linear-gradient(45deg,#f59e0b,#f59e0b 6px,#181005 6px,#181005 12px);border-radius:2px}
.route{display:grid;grid-template-columns:minmax(240px,1fr) 56px minmax(360px,1.5fr) 56px minmax(240px,1fr);gap:0;align-items:stretch}
.route section{margin:0}
.connection{background:var(--bg-card)!important;border:1px solid var(--border-subtle)!important;border-radius:8px;padding:16px!important;display:flex;flex-direction:column;gap:10px}
.connection h2{display:flex;align-items:center;gap:8px;font-size:16px;margin:0;color:var(--text-main)}
.provider-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 6px;border-radius:4px;background:#1e293b;font-size:11px;font-weight:700;color:var(--text-main)}
.provider-badge.aws-badge{border:1px solid #ff990033}
.provider-badge.supabase-badge{border:1px solid #3ecf8e33}
.provider-badge.dropbox-badge{border:1px solid #0061ff33}
.provider-badge.s3-badge{border:1px solid #ff990033}
.machine{position:relative;background:var(--bg-card)!important;border:2px solid #2e435e!important;border-radius:10px;padding:16px!important;box-shadow:0 0 30px rgba(0,220,130,0.06);background-image:radial-gradient(rgba(0,220,130,0.08) 1px,transparent 1px),linear-gradient(to right,rgba(255,255,255,0.02) 1px,transparent 1px),linear-gradient(to bottom,rgba(255,255,255,0.02) 1px,transparent 1px)!important;background-size:18px 18px!important}
.enclave-bolt{position:absolute;font-size:14px;color:#475569;line-height:1;user-select:none}
.enclave-bolt.top-left{top:4px;left:6px}.enclave-bolt.top-right{top:4px;right:6px}.enclave-bolt.bottom-left{bottom:4px;left:6px}.enclave-bolt.bottom-right{bottom:4px;right:6px}
.enclave-header-banner{background:#0d1829;border:1px solid #1e3a5f;border-radius:6px;padding:6px 10px;margin-bottom:12px;font-size:11px;font-weight:700;color:#38bdf8;letter-spacing:0.5px;text-align:center;text-transform:uppercase}
.enclave-internal-modules{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
.internal-module{background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:6px;padding:10px;font-size:12px}
.internal-module-title{display:flex;align-items:center;justify-content:space-between;font-weight:700;font-size:12px;margin-bottom:4px}
.status-pill{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;padding:2px 6px;border-radius:10px}
.status-pill.connected{color:#34d399;background:#064e3b55;border:1px solid #05966955}
.status-pill.awaiting{color:#fbbf24;background:#78350f44;border:1px solid #d9770644}
.enclave-core{background:#090d14;border:1px solid #23344d;border-radius:8px;padding:12px;margin-bottom:12px}
.enclave-core-title{font-size:12px;font-weight:800;color:var(--accent-green);letter-spacing:0.8px;margin-bottom:8px;display:flex;align-items:center;gap:6px}
.data-pipe{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;min-height:48px;overflow:hidden}
.data-pipe.down{min-height:46px;height:46px;margin:0 auto}
.pipe-label{position:absolute;font-size:10px;font-weight:700;letter-spacing:0.5px;color:var(--text-muted);text-transform:uppercase;background:var(--bg-deep);padding:1px 4px;border-radius:3px;z-index:2;white-space:nowrap}
.pipe-svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.pipe-track{stroke:var(--border-bold);stroke-width:3}
.pipe-flow{stroke:var(--accent-green);stroke-width:3;stroke-dasharray:6 6;animation:pipeFlowForward 1.2s linear infinite}
.flow-reverse .pipe-flow{stroke:var(--accent-cyan);animation:pipeFlowReverse 1.2s linear infinite}
.pipe-dimmed{opacity:0.25;filter:grayscale(0.8)}
.data-pipe.active .pipe-flow{stroke-width:4;animation-duration:0.5s;filter:drop-shadow(0 0 4px var(--accent-green))}
.data-pipe i{display:none}
@keyframes pipeFlowForward{from{stroke-dashoffset:24}to{stroke-dashoffset:0}}
@keyframes pipeFlowReverse{from{stroke-dashoffset:-24}to{stroke-dashoffset:0}}
.capsule-branch{width:min(480px,100%);margin:0 auto}
.capsule-branch section{background:var(--bg-card)!important;border:1px solid var(--border-subtle)!important;border-radius:8px;padding:16px}
.capsule-branch section.good{border-color:#05966966!important}
.capsule-branch section.warn{border-color:#d9770666!important}
.vault-badges{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.vault-badge-item{font-size:11px;font-weight:600;padding:3px 8px;border-radius:4px;background:#1e293b;border:1px solid #334155;color:#94a3b8}
.vault-badge-item.active-badge{background:#064e3b;border-color:#10b981;color:#6ee7b7}
.vault-toggle-bar{display:flex;gap:6px;margin:8px 0}
.vault-toggle-btn{background:#1e293b;color:var(--text-muted);border:1px solid var(--border-subtle);padding:4px 10px;font-size:11px;font-weight:700;border-radius:4px;cursor:pointer}
.vault-toggle-btn.active{background:#0f766e;color:#fff;border-color:#14b8a6}
.capsule-display{text-align:center}
.capsule-jar{position:relative;height:100px;width:76px;border:3px solid #0f766e;border-top:6px solid #14b8a6;border-radius:8px 8px 18px 18px;overflow:hidden;margin:8px auto;background:#0a1924}
.capsule-water{position:absolute;bottom:0;left:0;width:100%;background:#0d9488;transition:height .5s}
.capsule-water:before{content:'';position:absolute;left:-20%;top:-4px;width:140%;height:8px;border-radius:50%;background:#2dd4bf}
.capsule-jar.active .capsule-water:before{animation:water-wave 2s ease-in-out infinite alternate}
@keyframes water-wave{to{transform:translateX(8%) rotate(3deg)}}
.capsule-jar strong{position:absolute;inset:38px 0 auto;color:#e6edf3;font-size:13px;font-weight:800}
.capsule-label-text{font-size:12px;color:var(--text-muted);margin:4px 0}
.attestation{background:#0c1420!important;border:1px solid #1e334d!important;border-radius:6px;padding:8px 10px;font-size:11px;margin-bottom:8px}
.attestation-title{font-size:12px;font-weight:700;color:#38bdf8;margin-bottom:4px}
.attestation-row{margin:2px 0;font-size:11px;line-height:1.3;color:var(--text-muted)}
.attestation code{font-size:10px;background:#162335;color:#7dd3fc;padding:2px 4px;border-radius:3px;word-break:break-all}
.btn-execute{background:#00dc82!important;color:#052e16!important;font-weight:800!important;font-size:14px!important;padding:12px 18px!important;border-radius:6px!important;width:100%;text-align:center;box-shadow:0 0 15px rgba(0,220,130,0.3);border:0;cursor:pointer}
.btn-execute:hover{background:#34d399!important}
.enclave-execute-form{margin-top:10px;padding:10px;background:#0d1829;border:1px solid #1e3a5f;border-radius:6px}
.enclave-execute-form label{font-size:12px;margin:6px 0}
.enclave-execute-form select{background:#111824;color:var(--text-main);border:1px solid var(--border-bold);padding:8px;border-radius:4px;font-size:12px}
.checkbox-row{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-muted);margin:4px 0}
.checkbox-row input{margin:0;accent-color:var(--accent-green)}
@media(max-width:860px){.route{grid-template-columns:1fr;gap:12px}.data-pipe{min-height:32px;height:32px}.enclave-internal-modules{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.pipe-flow,.capsule-jar.active .capsule-water:before{animation:none}}
`;
