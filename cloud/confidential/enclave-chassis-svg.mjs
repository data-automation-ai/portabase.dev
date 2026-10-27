const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function enclaveChassisSvg() {
  return `<svg class="enclave-chassis-svg" viewBox="0 0 600 520" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="chassisSteel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#475569"/><stop offset="25%" stop-color="#1e293b"/>
      <stop offset="50%" stop-color="#334155"/><stop offset="75%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
    <linearGradient id="chassisInnerSteel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0e1522"/><stop offset="100%" stop-color="#080c14"/>
    </linearGradient>
    <linearGradient id="boltGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#94a3b8"/><stop offset="50%" stop-color="#475569"/><stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="cyanPcbTrace" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.45"/>
      <stop offset="50%" stop-color="#00dc82" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.45"/>
    </linearGradient>
    <filter id="pcbTraceGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="1.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Metallic Beveled Outer Chassis -->
  <polygon points="28,4 572,4 596,28 596,492 572,516 28,516 4,492 4,28" fill="url(#chassisSteel)" stroke="#64748b" stroke-width="2"/>
  <polygon points="30,8 570,8 592,30 592,490 570,512 30,512 8,490 8,30" fill="url(#chassisInnerSteel)" stroke="#1e293b" stroke-width="1.5"/>

  <!-- Top Nameplate Tab: Intel TDX Enclave Hardware -->
  <path d="M 165,4 L 177,22 L 423,22 L 435,4 Z" fill="#182234" stroke="#3b4d66" stroke-width="1.5"/>
  <text x="300" y="17" text-anchor="middle" font-size="8.5" font-weight="800" fill="#38bdf8" letter-spacing="0.8">INTEL TDX ENCLAVE · ANTI-LANDLORD SILICON</text>

  <!-- Corner Mounting Plates with Realistic 3D Hex Bolts -->
  <g class="corner-bolts">
    <!-- Top-Left Bolt -->
    <rect x="10" y="10" width="22" height="22" rx="4" fill="#1e293b" stroke="#334155"/>
    <polygon points="21,13 27,16 27,23 21,26 15,23 15,16" fill="url(#boltGrad)" stroke="#94a3b8" stroke-width="0.8"/>
    <circle cx="21" cy="19.5" r="2.5" fill="#0b0f17" stroke="#334155" stroke-width="0.8"/>

    <!-- Top-Right Bolt -->
    <rect x="568" y="10" width="22" height="22" rx="4" fill="#1e293b" stroke="#334155"/>
    <polygon points="579,13 585,16 585,23 579,26 573,23 573,16" fill="url(#boltGrad)" stroke="#94a3b8" stroke-width="0.8"/>
    <circle cx="579" cy="19.5" r="2.5" fill="#0b0f17" stroke="#334155" stroke-width="0.8"/>

    <!-- Bottom-Left Bolt -->
    <rect x="10" y="488" width="22" height="22" rx="4" fill="#1e293b" stroke="#334155"/>
    <polygon points="21,491 27,494 27,501 21,504 15,501 15,494" fill="url(#boltGrad)" stroke="#94a3b8" stroke-width="0.8"/>
    <circle cx="21" cy="497.5" r="2.5" fill="#0b0f17" stroke="#334155" stroke-width="0.8"/>

    <!-- Bottom-Right Bolt -->
    <rect x="568" y="488" width="22" height="22" rx="4" fill="#1e293b" stroke="#334155"/>
    <polygon points="579,491 585,494 585,501 579,504 573,501 573,494" fill="url(#boltGrad)" stroke="#94a3b8" stroke-width="0.8"/>
    <circle cx="579" cy="497.5" r="2.5" fill="#0b0f17" stroke="#334155" stroke-width="0.8"/>
  </g>

  <!-- Glowing Silicon Circuit Traces & Micro-Vias -->
  <g class="pcb-circuits" stroke="url(#cyanPcbTrace)" stroke-width="1.2" fill="none" filter="url(#pcbTraceGlow)">
    <path d="M 40,50 L 80,50 L 110,80 L 110,130"/>
    <path d="M 560,50 L 520,50 L 490,80 L 490,130"/>
    <path d="M 35,260 L 65,260 L 95,290 L 95,380 L 70,405 L 40,405"/>
    <path d="M 565,260 L 535,260 L 505,290 L 505,380 L 530,405 L 560,405"/>
    <path d="M 120,490 L 145,465 L 180,465"/>
    <path d="M 480,490 L 455,465 L 420,465"/>
    <path d="M 280,30 L 280,70 L 300,90 L 300,120"/>
    <path d="M 320,30 L 320,70 L 300,90"/>
    <!-- Micro-vias -->
    <circle cx="80" cy="50" r="2" fill="#080c14" stroke="#00dc82" stroke-width="1.2"/>
    <circle cx="520" cy="50" r="2" fill="#080c14" stroke="#00dc82" stroke-width="1.2"/>
    <circle cx="110" cy="130" r="2" fill="#080c14" stroke="#38bdf8" stroke-width="1.2"/>
    <circle cx="490" cy="130" r="2" fill="#080c14" stroke="#38bdf8" stroke-width="1.2"/>
    <circle cx="95" cy="380" r="2" fill="#080c14" stroke="#00dc82" stroke-width="1.2"/>
    <circle cx="505" cy="380" r="2" fill="#080c14" stroke="#00dc82" stroke-width="1.2"/>
  </g>
</svg>`;
}

export function internalConduitArrow(name, { active = false, direction = 'down', dimmed = false } = {}) {
  const isUp = direction === 'up';
  const flowClass = isUp ? 'flow-up' : 'flow-down';
  const dimClass = dimmed ? 'conduit-dimmed' : '';
  const activeClass = active ? 'conduit-active' : '';

  return `<div class="internal-conduit ${name} ${flowClass} ${dimClass} ${activeClass}">
    <svg viewBox="0 0 24 38" preserveAspectRatio="none" class="internal-conduit-svg">
      <line x1="12" y1="${isUp ? 34 : 4}" x2="12" y2="${isUp ? 8 : 30}" class="conduit-track"/>
      <line x1="12" y1="${isUp ? 34 : 4}" x2="12" y2="${isUp ? 8 : 30}" class="conduit-flow"/>
      <polygon points="${isUp ? '12,2 7,10 17,10' : '12,36 7,28 17,28'}" class="conduit-arrowhead"/>
    </svg>
  </div>`;
}

export function renderMultiLayerConduit(active, direction = 'right', opts = {}) {
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

  if (direction === 'down') {
    return `<div aria-label="${active ? 'Transfer active' : 'Transfer idle'}" class="data-pipe down ${active ? 'active' : ''} ${flowClass} ${dimClass}">
      <span class="pipe-label">${esc(label)}</span>
      <svg class="pipe-svg pipe-svg-down" viewBox="0 0 32 64" preserveAspectRatio="none">
        <line x1="16" y1="4" x2="16" y2="60" class="pipe-track-wide"/>
        <line x1="16" y1="4" x2="16" y2="60" class="pipe-channel"/>
        <line x1="16" y1="4" x2="16" y2="60" class="pipe-stream"/>
        <polygon points="${isReverse ? '16,2 10,12 22,12' : '16,62 10,52 22,52'}" class="pipe-arrowhead"/>
        <circle cx="16" cy="16" r="3.5" class="packet-orb packet-orb-v"/>
      </svg>
      <i></i><i></i><i></i>
    </div>`;
  }

  return `<div aria-label="${active ? 'Transfer active' : 'Transfer idle'}" class="data-pipe ${dirClass} ${active ? 'active' : ''} ${flowClass} ${dimClass}">
    <span class="pipe-label">${esc(label)}</span>
    <svg class="pipe-svg pipe-svg-h" viewBox="0 0 80 28" preserveAspectRatio="none">
      <line x1="6" y1="14" x2="74" y2="14" class="pipe-track-wide"/>
      <line x1="6" y1="14" x2="74" y2="14" class="pipe-channel"/>
      <line x1="6" y1="14" x2="74" y2="14" class="pipe-stream"/>
      <polygon points="6,14 14,8 14,20" class="pipe-arrowhead-left"/>
      <polygon points="74,14 66,8 66,20" class="pipe-arrowhead-right"/>
      <circle cx="20" cy="14" r="3.5" class="packet-orb packet-orb-h"/>
    </svg>
    <i></i><i></i><i></i>
  </div>`;
}
