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

export const machineCss = `
:root{--bg-deep:#0b0f17;--bg-card:#111824;--bg-elevated:#162032;--border-subtle:#233044;--border-bold:#3b4d66;--text-main:#e6edf3;--text-muted:#8b949e;--accent-green:#00dc82;--accent-cyan:#38bdf8;--accent-amber:#f59e0b;--accent-red:#f87171}
body{background:var(--bg-deep)!important;color:var(--text-main)!important;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;margin:12px auto!important;max-width:1240px!important}
.landlord-perimeter-bar{display:flex;align-items:center;justify-content:center;gap:12px;padding:5px 12px;margin:0 0 10px 0;background:#181005;border:1px solid #78350f;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:1px;color:#fbbf24;text-transform:uppercase}
.hazard-stripes{display:inline-block;width:32px;height:8px;background:repeating-linear-gradient(45deg,#f59e0b,#f59e0b 6px,#181005 6px,#181005 12px);border-radius:2px}
.route{display:grid;grid-template-columns:minmax(220px,1.05fr) 72px minmax(380px,1.65fr) 72px minmax(220px,1.05fr);gap:0;align-items:center}
.route section{margin:0}
.connection{background:var(--bg-card)!important;border:1px solid var(--border-subtle)!important;border-radius:8px;padding:12px 14px!important;display:flex;flex-direction:column;gap:8px}
.connection h2{display:flex;align-items:center;gap:6px;font-size:15px;margin:0;color:var(--text-main)}
.provider-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 5px;border-radius:4px;background:#1e293b;font-size:10px;font-weight:700;color:var(--text-main)}
.provider-badge.aws-badge{border:1px solid #ff990033}
.provider-badge.supabase-badge{border:1px solid #3ecf8e33}
.provider-badge.dropbox-badge{border:1px solid #0061ff33}
.provider-badge.s3-badge{border:1px solid #ff990033}
.machine{position:relative;background:#090d14!important;border:0!important;border-radius:12px;padding:26px 20px 18px!important;box-shadow:0 0 35px rgba(0,220,130,0.08);overflow:hidden}
.enclave-chassis-svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0}
.enclave-header-banner{position:relative;z-index:1;background:#0d1829;border:1px solid #1e3a5f;border-radius:6px;padding:5px 8px;margin-bottom:10px;font-size:10px;font-weight:800;color:#38bdf8;letter-spacing:0.5px;text-align:center;text-transform:uppercase}
.enclave-internal-modules{position:relative;z-index:1;display:grid;grid-template-columns:1fr 1fr;gap:10px}
.internal-module{background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:6px;padding:8px 10px;font-size:11px}
.internal-module-title{display:flex;align-items:center;justify-content:space-between;font-weight:700;font-size:11px;margin-bottom:2px}
.status-pill{display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;padding:1px 5px;border-radius:8px}
.status-pill.connected{color:#34d399;background:#064e3b55;border:1px solid #05966955}
.status-pill.awaiting{color:#fbbf24;background:#78350f44;border:1px solid #d9770644}
.internal-conduits-row{position:relative;z-index:1;display:grid;grid-template-columns:1fr 1fr;gap:10px;height:24px;margin:2px 0}
.internal-conduit{display:flex;align-items:center;justify-content:center;height:100%}
.internal-conduit-svg{width:20px;height:22px}
.conduit-track{stroke:#1e293b;stroke-width:3}
.conduit-flow{stroke:var(--accent-green);stroke-width:2.2;stroke-dasharray:4 4;animation:conduitFlowDown 0.9s linear infinite}
.flow-up .conduit-flow{stroke:var(--accent-cyan);animation:conduitFlowUp 0.9s linear infinite}
.conduit-arrowhead{fill:var(--accent-green)}
.flow-up .conduit-arrowhead{fill:var(--accent-cyan)}
.conduit-dimmed{opacity:0.2;filter:grayscale(1)}
.conduit-active .conduit-flow{stroke-width:3.2;animation-duration:0.35s;filter:drop-shadow(0 0 4px var(--accent-green))}
@keyframes conduitFlowDown{from{stroke-dashoffset:16}to{stroke-dashoffset:0}}
@keyframes conduitFlowUp{from{stroke-dashoffset:-16}to{stroke-dashoffset:0}}
.enclave-core{position:relative;z-index:1;background:#060a10;border:1px solid #1e334d;border-radius:8px;padding:10px 12px;margin:2px 0}
.enclave-core-title{font-size:11px;font-weight:800;color:var(--accent-green);letter-spacing:0.8px;margin-bottom:6px;display:flex;align-items:center;gap:6px}
.enclave-vault-conduit{position:relative;z-index:1;display:flex;justify-content:center;height:20px;margin:2px 0}
.data-pipe{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;min-height:50px}
.data-pipe.down{min-height:48px;height:48px;margin:0 auto}
.pipe-label{position:absolute;font-size:9px;font-weight:700;letter-spacing:0.5px;color:#94a3b8;text-transform:uppercase;background:var(--bg-deep);padding:1px 5px;border-radius:3px;z-index:3;white-space:nowrap;border:1px solid #1e293b}
.pipe-svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1}
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
.pipe-dimmed{opacity:0.25;filter:grayscale(0.8)}
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
.capsule-branch section{background:var(--bg-card)!important;border:1px solid var(--border-subtle)!important;border-radius:8px;padding:12px 14px}
.vault-badges{display:flex;flex-wrap:wrap;gap:5px;margin:6px 0}
.vault-badge-item{font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;background:#1e293b;border:1px solid #334155;color:#94a3b8}
.vault-badge-item.active-badge{background:#064e3b;border-color:#10b981;color:#6ee7b7}
.vault-toggle-bar{display:flex;gap:5px;margin:6px 0}
.vault-toggle-btn{background:#1e293b;color:var(--text-muted);border:1px solid var(--border-subtle);padding:3px 8px;font-size:10px;font-weight:700;border-radius:4px;cursor:pointer}
.vault-toggle-btn.active{background:#0f766e;color:#fff;border-color:#14b8a6}
.capsule-display{text-align:center}
.capsule-jar{position:relative;height:76px;width:60px;border:2.5px solid #0f766e;border-top:5px solid #14b8a6;border-radius:6px 6px 14px 14px;overflow:hidden;margin:6px auto;background:#0a1924}
.capsule-water{position:absolute;bottom:0;left:0;width:100%;background:#0d9488;transition:height .5s}
.capsule-water:before{content:'';position:absolute;left:-20%;top:-3px;width:140%;height:6px;border-radius:50%;background:#2dd4bf}
.capsule-jar.active .capsule-water:before{animation:water-wave 2s ease-in-out infinite alternate}
@keyframes water-wave{to{transform:translateX(8%) rotate(3deg)}}
.capsule-jar strong{position:absolute;inset:28px 0 auto;color:#e6edf3;font-size:11px;font-weight:800}
.capsule-label-text{font-size:11px;color:var(--text-muted);margin:2px 0}
.attestation{background:#0a121c!important;border:1px solid #1e334d!important;border-radius:6px;padding:6px 8px;font-size:10.5px;margin-bottom:6px}
.attestation-title{font-size:11px;font-weight:700;color:#38bdf8;margin-bottom:2px}
.attestation-row{margin:1px 0;font-size:10px;line-height:1.25;color:var(--text-muted)}
.attestation code{font-size:9.5px;background:#162335;color:#7dd3fc;padding:1px 4px;border-radius:3px}
.btn-execute{background:#00dc82!important;color:#052e16!important;font-weight:800!important;font-size:13px!important;padding:9px 14px!important;border-radius:6px!important;width:100%;text-align:center;box-shadow:0 0 16px rgba(0,220,130,0.25);border:0;cursor:pointer}
.btn-execute:hover{background:#34d399!important}
.enclave-execute-form{margin-top:6px;padding:8px 10px;background:#0d1829;border:1px solid #1e3a5f;border-radius:6px}
.enclave-execute-form label{font-size:11px;margin:4px 0}
.enclave-execute-form select{background:#111824;color:var(--text-main);border:1px solid var(--border-bold);padding:6px;border-radius:4px;font-size:11px}
.checkbox-row{display:flex;align-items:center;gap:5px;font-size:10.5px;color:var(--text-muted);margin:3px 0}
.checkbox-row input{margin:0;accent-color:var(--accent-green)}
.legacy-diagnostics{margin-top:18px;border:1px solid var(--border-subtle);border-radius:8px;background:#0d131f}
.legacy-diagnostics summary{padding:8px 12px;font-size:11px;font-weight:700;color:#64748b;cursor:pointer}
.legacy-diagnostics summary:hover{color:#94a3b8}
.legacy-diagnostics-inner{padding:10px;border-top:1px solid #1e293b}
@media(max-width:860px){.route{grid-template-columns:1fr;gap:10px}.data-pipe{min-height:28px;height:28px}.enclave-internal-modules{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.pipe-stream,.conduit-flow,.packet-orb,.capsule-jar.active .capsule-water:before{animation:none}}
`;
