import { enclaveChassisSvg, internalConduitArrow, renderMultiLayerConduit } from './enclave-chassis-svg.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export { enclaveChassisSvg, internalConduitArrow };

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
  return renderMultiLayerConduit(active, direction, opts);
}

export function capsuleJar(status) {
  const view = transferView(status);
  return `<div class="capsule-display"><div class="capsule-jar ${view.vaultActive ? 'active' : ''}" role="img" aria-label="${esc(view.label)}${view.percent === null ? '' : ` · ${Math.floor(view.percent)} percent`}"><div class="capsule-water" style="height:${view.percent ?? 0}%"></div><strong>${view.percent === null ? '—' : `${Math.floor(view.percent)}%`}</strong></div><p class="capsule-label-text">${esc(view.label)}</p></div>`;
}

export function sourceReadMeter(status = {}) {
  const backup = status.backup;
  if (status.mode === 'restore_only') {
    return `<div class="io-meter" data-meter="source-read"><div class="io-meter-head"><span>Source Read · <small class="io-meter-sub" style="display:inline;margin:0">Bypassed (Mode 4)</small></span><strong>0%</strong></div><div class="io-meter-track"><div class="io-meter-fill" style="width:0%"></div></div></div>`;
  }
  const done = backup?.state === 'complete' || Boolean(status.backupExecuted) || ['package', 'encrypt', 'transfer', 'done'].includes(backup?.phase);
  const raw = Number(backup?.estimatedPercent);
  const phasePct = { preflight: 3, 'database-manifest': 10, database: 35, storage: 72, functions: 95 }[backup?.phase];
  const percent = done ? 100 : (Number.isFinite(raw) && raw > 0 ? Math.min(99, Math.max(1, Math.round((raw / 85) * 100))) : (phasePct ?? (status.state === 'capturing' ? 2 : 0)));
  const active = Boolean(status.executing) && backup?.state === 'running' && !done;
  const sub = done ? '100% read' : backup?.state === 'failed' ? 'Interrupted' : active || backup?.phase ? `Reading ${backup?.phase || 'source'}…` : 'Ready';
  return `<div class="io-meter${active ? ' active' : ''}" data-meter="source-read"><div class="io-meter-head"><span>Source Read · <small class="io-meter-sub" style="display:inline;margin:0">${esc(sub)}</small></span><strong>${percent}%</strong></div><div class="io-meter-track" role="progressbar" aria-label="Source Read percent" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><div class="io-meter-fill" style="width:${percent}%"></div></div></div>`;
}

export function destinationWriteMeter(status = {}) {
  const restore = status.restore;
  if (status.mode === 'capsule_only') {
    return `<div class="io-meter" data-meter="destination-write"><div class="io-meter-head"><span>Destination Written · <small class="io-meter-sub" style="display:inline;margin:0">Bypassed (Mode 3)</small></span><strong>0%</strong></div><div class="io-meter-track"><div class="io-meter-fill io-meter-fill-target" style="width:0%"></div></div></div>`;
  }
  const done = restore?.state === 'complete' || Boolean(status.restoreExecuted) || status.state === 'complete';
  const raw = Number(restore?.estimatedPercent);
  const phasePct = { transfer: 12, preflight: 22, 'database-manifest': 35, database: 58, schema: 45, data: 65, auth: 75, storage: 86, functions: 94, verify: 98, done: 99, complete: 100 }[restore?.phase];
  const percent = done ? 100 : (Number.isFinite(raw) && raw > 0 ? Math.min(99, Math.round(raw)) : (phasePct ?? (restore?.state === 'running' || status.state === 'restoring' ? 25 : 0)));
  const active = Boolean(status.executing) && (restore?.state === 'running' || status.state === 'restoring') && !done;
  const sub = done ? '100% written' : restore?.state === 'failed' ? 'Interrupted' : active || restore?.phase ? `Writing ${restore?.phase || 'destination'}…` : 'Ready';
  return `<div class="io-meter${active ? ' active' : ''}" data-meter="destination-write"><div class="io-meter-head"><span>Destination Written · <small class="io-meter-sub" style="display:inline;margin:0">${esc(sub)}</small></span><strong>${percent}%</strong></div><div class="io-meter-track" role="progressbar" aria-label="Destination Written percent" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><div class="io-meter-fill io-meter-fill-target" style="width:${percent}%"></div></div></div>`;
}

export const machineCss = `
:root{--bg-deep:#0b0f17;--bg-card:#111824;--bg-elevated:#162032;--border-subtle:#233044;--border-bold:#3b4d66;--text-main:#e6edf3;--text-muted:#8b949e;--accent-green:#00dc82;--accent-cyan:#38bdf8;--accent-amber:#f59e0b;--accent-red:#f87171}
body{background:#ffffff!important;color:#0f172a!important;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;margin:4px 0!important;padding:0 16px!important;max-width:100%!important;width:100%!important;box-sizing:border-box}
.route{display:grid;width:100%;grid-template-columns:minmax(220px,1fr) 52px minmax(520px,2.2fr) 52px minmax(220px,1fr);gap:0;align-items:start}
.route section{margin:0}
.route>.connection{margin-top:8px}
.route>.data-pipe.right{margin-top:68px;height:44px;align-self:start}
.connection{background:#090d14!important;color:var(--text-main)!important;border:1px solid var(--border-subtle)!important;border-radius:8px;padding:7px 10px!important;display:flex;flex-direction:column;gap:3px;box-shadow:0 6px 18px rgba(15,23,42,0.14)}
.connection h2{display:flex;align-items:center;gap:6px;font-size:13px;margin:0;color:var(--text-main)}
.provider-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 5px;border-radius:4px;background:#1e293b;font-size:10px;font-weight:700;color:var(--text-main)}
.provider-badge.supabase-badge{border:1px solid #3ecf8e33}
.provider-badge.dropbox-badge{border:1px solid #0061ff33}
.io-meter{background:#0b121e;border:1px solid #1e334d;border-radius:5px;padding:3px 7px;margin:0}
.io-meter.active{border-color:#00dc8288;box-shadow:0 0 10px rgba(0,220,130,0.18)}
.io-meter-head{display:flex;align-items:center;justify-content:space-between;font-size:10px;font-weight:700;color:var(--text-main);margin-bottom:2px}
.io-meter-head strong{color:var(--accent-green);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px}
.io-meter[data-meter="destination-write"] .io-meter-head strong{color:var(--accent-cyan)}
.io-meter-track{height:5px;width:100%;background:#162234;border-radius:999px;overflow:hidden;border:1px solid #23354f}
.io-meter-fill{height:100%;background:linear-gradient(90deg,#059669,#00dc82);border-radius:999px;transition:width .4s ease}
.io-meter-fill-target{background:linear-gradient(90deg,#0284c7,#38bdf8)}
.io-meter-sub{display:block;margin-top:2px;font-size:9.5px;color:var(--text-muted)}
.machine{position:relative;background:#090d14!important;color:var(--text-main)!important;border:0!important;border-radius:12px;padding:20px 14px 12px!important;box-shadow:0 0 0 2px rgba(239,68,68,0.85),0 0 10px 2px rgba(239,68,68,0.45);animation:intrusionBoundaryIdle 1.8s ease-in-out infinite alternate;overflow:hidden}
.machine.machine-executing{animation:intrusionBoundaryActive 1s ease-in-out infinite alternate}
@keyframes intrusionBoundaryIdle{0%{box-shadow:0 0 0 2px rgba(239,68,68,0.8),0 0 8px 2px rgba(239,68,68,0.4)}100%{box-shadow:0 0 0 5px rgba(239,68,68,0.65),0 0 16px 5px rgba(239,68,68,0.3)}}
@keyframes intrusionBoundaryActive{0%{box-shadow:0 0 0 2px #ef4444,0 0 10px 2px rgba(239,68,68,0.65)}100%{box-shadow:0 0 0 11px rgba(239,68,68,0.9),0 0 26px 11px rgba(239,68,68,0.5)}}
.enclave-chassis-svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0}
.enclave-header-banner{position:relative;z-index:1;background:#0d1829;border:1px solid #1e3a5f;border-radius:6px;padding:4px 8px;margin-bottom:6px;font-size:9.5px;font-weight:800;color:#38bdf8;letter-spacing:0.4px;text-align:center;text-transform:uppercase}
.enclave-internal-modules{position:relative;z-index:1;display:grid;grid-template-columns:1fr 1fr;gap:8px}
.internal-module{position:relative;z-index:1;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:6px;padding:5px 8px;font-size:10.5px}
.internal-module-title{display:flex;align-items:center;justify-content:space-between;font-weight:700;font-size:10.5px;margin-bottom:0}
.status-pill{display:inline-flex;align-items:center;gap:3px;font-size:9.5px;font-weight:700;padding:1px 5px;border-radius:8px}
.status-pill.connected{color:#34d399;background:#064e3b55;border:1px solid #05966955}
.status-pill.awaiting{color:#fbbf24;background:#78350f44;border:1px solid #d9770644}
.internal-conduits-row{position:relative;z-index:1;display:grid;grid-template-columns:1fr 1fr;gap:8px;height:16px;margin:1px 0}
.internal-conduit{display:flex;align-items:center;justify-content:center;height:100%}
.internal-conduit-svg{width:18px;height:16px}
.conduit-track{stroke:#1e293b;stroke-width:3}
.conduit-flow{stroke:var(--accent-green);stroke-width:2.2;stroke-dasharray:4 4;animation:conduitFlowDown 0.9s linear infinite}
.flow-up .conduit-flow{stroke:var(--accent-cyan);animation:conduitFlowUp 0.9s linear infinite}
.conduit-arrowhead{fill:var(--accent-green)}
.flow-up .conduit-arrowhead{fill:var(--accent-cyan)}
.conduit-dimmed{opacity:0.2;filter:grayscale(1)}
.conduit-active .conduit-flow{stroke-width:3.2;animation-duration:0.35s;filter:drop-shadow(0 0 4px var(--accent-green))}
@keyframes conduitFlowDown{from{stroke-dashoffset:16}to{stroke-dashoffset:0}}
@keyframes conduitFlowUp{from{stroke-dashoffset:-16}to{stroke-dashoffset:0}}
.enclave-core{position:relative;z-index:1;background:#060a10;border:1px solid #1e334d;border-radius:8px;padding:7px 10px;margin:1px 0}
.enclave-core-title{font-size:10.5px;font-weight:800;color:var(--accent-green);letter-spacing:0.6px;margin-bottom:4px;display:flex;align-items:center;gap:6px}
.enclave-vault-conduit{position:relative;z-index:1;display:flex;justify-content:center;height:16px;margin:1px 0}
.data-pipe{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;min-height:36px}
.data-pipe.down{min-height:28px;height:28px;margin:0 auto}
.pipe-label{position:absolute;font-size:9px;font-weight:700;letter-spacing:0.5px;color:#94a3b8;text-transform:uppercase;background:var(--bg-deep);padding:1px 5px;border-radius:3px;z-index:3;white-space:nowrap;border:1px solid #1e293b}
.pipe-svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1}
.data-pipe.right .pipe-svg-h{inset:50% 0 auto;width:100%;height:30px;box-sizing:border-box;transform:translateY(-50%);border:2px solid #536b80;border-radius:6px;background:linear-gradient(180deg,#172737 0%,#658096 18%,#30485c 42%,#142536 65%,#405b70 85%,#172737 100%);box-shadow:inset 0 1px 2px #b6d6e655,0 2px 5px #0008}
.data-pipe.right .pipe-label{top:calc(50% - 36px)}
.pipe-track-wide{stroke:#1e293b;stroke-width:8;stroke-linecap:round}
.pipe-channel{stroke:#090d14;stroke-width:4}
.pipe-stream{stroke:var(--accent-green);stroke-width:2.5;stroke-dasharray:6 6;animation:pipeStreamH 1.1s linear infinite}
.flow-reverse .pipe-stream{stroke:var(--accent-cyan);animation:pipeStreamHRev 1.1s linear infinite}
.pipe-arrowhead-left,.pipe-arrowhead-right{fill:var(--accent-green)}
.flow-reverse .pipe-arrowhead-left,.flow-reverse .pipe-arrowhead-right{fill:var(--accent-cyan)}
.data-pipe.down .pipe-stream{animation:pipeStreamV 1.1s linear infinite}
.data-pipe.down.flow-reverse .pipe-stream{animation:pipeStreamVRev 1.1s linear infinite}
.pipe-arrowhead{fill:var(--accent-green)}
.data-pipe.down.flow-reverse .pipe-arrowhead{fill:var(--accent-cyan)}
.packet-orb{fill:#fff;filter:drop-shadow(0 0 4px var(--accent-green))}
.packet-orb-h{animation:packetMoveH 1.6s ease-in-out infinite alternate}
.packet-orb-v{animation:packetMoveV 1.6s ease-in-out infinite alternate}
.flow-reverse .packet-orb{filter:drop-shadow(0 0 4px var(--accent-cyan))}
.pipe-dimmed{opacity:0.75;filter:grayscale(0.35)}
.data-pipe.active .pipe-stream{stroke-width:3.5;animation-duration:0.45s;filter:drop-shadow(0 0 5px var(--accent-green))}
.data-pipe.active .packet-orb{filter:drop-shadow(0 0 8px var(--accent-green))}
.data-pipe i{display:none}
@keyframes pipeStreamH{from{stroke-dashoffset:24}to{stroke-dashoffset:0}}
@keyframes pipeStreamHRev{from{stroke-dashoffset:-24}to{stroke-dashoffset:0}}
@keyframes pipeStreamV{from{stroke-dashoffset:24}to{stroke-dashoffset:0}}
@keyframes pipeStreamVRev{from{stroke-dashoffset:-24}to{stroke-dashoffset:0}}
@keyframes packetMoveH{0%{cx:14px;opacity:0.3}50%{opacity:1}100%{cx:66px;opacity:0.3}}
@keyframes packetMoveV{0%{cy:12px;opacity:0.3}50%{opacity:1}100%{cy:52px;opacity:0.3}}
.capsule-branch{width:min(500px,100%);margin:0 auto}
.capsule-branch section{background:#090d14!important;color:var(--text-main)!important;border:1px solid var(--border-subtle)!important;border-radius:8px;padding:12px 14px;box-shadow:0 6px 18px rgba(15,23,42,0.14)}
.vault-badges{display:flex;flex-wrap:wrap;gap:5px;margin:6px 0}
.vault-badge-item{font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;background:#1e293b;border:1px solid #334155;color:#94a3b8}
.vault-badge-item.active-badge{background:#064e3b;border-color:#10b981;color:#6ee7b7}
.vault-toggle-bar{display:flex;gap:5px;margin:6px 0}
.vault-toggle-btn{background:#1e293b;color:var(--text-muted);border:1px solid var(--border-subtle);padding:3px 8px;font-size:10px;font-weight:700;border-radius:4px;cursor:pointer}
.vault-toggle-btn.active{background:#0f766e;color:#fff;border-color:#14b8a6}
.capsule-display{text-align:center}
.capsule-jar{position:relative;height:52px;width:46px;border:2px solid #0f766e;border-top:4px solid #14b8a6;border-radius:5px 5px 12px 12px;overflow:hidden;margin:2px auto;background:#0a1924}
.capsule-water{position:absolute;bottom:0;left:0;width:100%;background:#0d9488;transition:height .5s}
.capsule-water:before{content:'';position:absolute;left:-20%;top:-3px;width:140%;height:6px;border-radius:50%;background:#2dd4bf}
.capsule-jar.active .capsule-water:before{animation:water-wave 2s ease-in-out infinite alternate}
@keyframes water-wave{to{transform:translateX(8%) rotate(3deg)}}
.capsule-jar strong{position:absolute;inset:17px 0 auto;color:#e6edf3;font-size:10px;font-weight:800}
.capsule-label-text{font-size:9.5px;color:var(--text-muted);margin:1px 0}
.attestation{background:#0a121c!important;border:1px solid #1e334d!important;border-radius:6px;padding:4px 7px;font-size:10px;margin-bottom:4px}
.attestation-title{font-size:10.5px;font-weight:700;color:#38bdf8;margin-bottom:1px}
.attestation-row{margin:1px 0;font-size:9.5px;line-height:1.25;color:var(--text-muted)}
.attestation code{font-size:9px;background:#162335;color:#7dd3fc;padding:1px 4px;border-radius:3px}
.btn-execute{background:#00dc82!important;color:#052e16!important;font-weight:800!important;font-size:12px!important;padding:6px 10px!important;border-radius:6px!important;width:100%;text-align:center;box-shadow:0 0 14px rgba(0,220,130,0.25);border:0;cursor:pointer}
.btn-execute:hover{background:#34d399!important}
.enclave-execute-form{margin-top:4px;padding:6px 8px;background:#0d1829;border:1px solid #1e3a5f;border-radius:6px}
.enclave-execute-form label{font-size:10.5px;margin:2px 0}
.enclave-execute-form select{background:#111824;color:var(--text-main);border:1px solid var(--border-bold);padding:4px 6px;border-radius:4px;font-size:10.5px}
.checkbox-row{display:flex;align-items:center;gap:5px;font-size:10.5px;color:var(--text-muted);margin:3px 0}
.checkbox-row input{margin:0;accent-color:var(--accent-green)}
.legacy-diagnostics{margin-top:18px;border:1px solid var(--border-subtle);border-radius:8px;background:#0d131f}
.legacy-diagnostics summary{padding:8px 12px;font-size:11px;font-weight:700;color:#64748b;cursor:pointer}
.legacy-diagnostics summary:hover{color:#94a3b8}
.legacy-diagnostics-inner{padding:10px;border-top:1px solid #1e293b}
@media(max-width:860px){.route{grid-template-columns:1fr;gap:10px}.data-pipe{min-height:28px;height:28px}.enclave-internal-modules{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.pipe-stream,.conduit-flow,.packet-orb,.capsule-jar.active .capsule-water:before{animation:none}}
`;
