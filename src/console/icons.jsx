import React from 'react';

/** Minimal SVG icon set — no emoji. */
export function Icon({ name, size = 16, className = '' }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', className, 'aria-hidden': true };
  switch (name) {
    case 'home': return <svg {...p}><path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1v-10.5z" /></svg>;
    case 'folder': return <svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></svg>;
    case 'cpu': return <svg {...p}><rect x="6" y="6" width="12" height="12" rx="1" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" /></svg>;
    case 'capsule': return <svg {...p}><rect x="4" y="7" width="16" height="10" rx="5" /><path d="M9 7v10M15 7v10" /></svg>;
    case 'clock': return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case 'cloud': return <svg {...p}><path d="M7 18h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.5-1.5A3.5 3.5 0 0 0 7 18z" /></svg>;
    case 'restore': return <svg {...p}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>;
    case 'bell': return <svg {...p}><path d="M6 9a6 6 0 1 1 12 0c0 7 3 7 3 7H3s3 0 3-7" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>;
    case 'activity': return <svg {...p}><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>;
    case 'chart': return <svg {...p}><path d="M4 19V5M4 19h16" /><path d="M8 16v-5M12 16V8M16 16v-3" /></svg>;
    case 'server': return <svg {...p}><rect x="3" y="4" width="18" height="6" rx="1" /><rect x="3" y="14" width="18" height="6" rx="1" /><path d="M7 7h.01M7 17h.01" /></svg>;
    case 'users': return <svg {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="3" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a3 3 0 0 1 0 5.74" /></svg>;
    case 'card': return <svg {...p}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>;
    case 'settings': return <svg {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
    case 'search': return <svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
    case 'plus': return <svg {...p}><path d="M12 5v14M5 12h14" /></svg>;
    case 'check': return <svg {...p}><path d="M20 6 9 17l-5-5" /></svg>;
    case 'x': return <svg {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>;
    case 'chevron': return <svg {...p}><path d="m9 6 6 6-6 6" /></svg>;
    case 'external': return <svg {...p}><path d="M14 4h6v6M10 14 20 4M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" /></svg>;
    case 'copy': return <svg {...p}><rect x="8" y="8" width="12" height="12" rx="1" /><path d="M4 16V5a1 1 0 0 1 1-1h11" /></svg>;
    case 'shield': return <svg {...p}><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z" /></svg>;
    case 'key': return <svg {...p}><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 5l2 2" /></svg>;
    case 'menu': return <svg {...p}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
    case 'spark': return <svg {...p}><path d="M12 2v6M12 16v6M4.9 4.9l4.2 4.2M14.9 14.9l4.2 4.2M2 12h6M16 12h6M4.9 19.1l4.2-4.2M14.9 9.1l4.2-4.2" /></svg>;
    case 'warn': return <svg {...p}><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17h.01" /></svg>;
    case 'logout': return <svg {...p}><path d="M10 17H5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5M14 16l4-4-4-4M18 12H9" /></svg>;
    default: return <svg {...p}><circle cx="12" cy="12" r="8" /></svg>;
  }
}
