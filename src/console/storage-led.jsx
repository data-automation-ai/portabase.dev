import React from 'react';

/**
 * Realistic LED status indicator light:
 * - red: No connection established (Solid Red)
 * - yellow: In the process of connecting (Solid Yellow)
 * - yellow-flash: Problem connecting (Flashing Yellow)
 * - green: Connected and healthy (Solid Green)
 * - red-flash: Stopped working / was working previously (Flashing Red)
 */
export function LedIndicator({ state = 'red', label = null, size = 12 }) {
  const configs = {
    red: { color: '#ff4d4f', glow: '0 0 8px rgba(255, 77, 79, 0.85)', animation: 'none', defaultLabel: 'Not Connected' },
    yellow: { color: '#faad14', glow: '0 0 8px rgba(250, 173, 20, 0.85)', animation: 'none', defaultLabel: 'Connecting...' },
    'yellow-flash': { color: '#faad14', glow: '0 0 10px rgba(250, 173, 20, 0.9)', animation: 'pb-led-blink-yellow 1s infinite', defaultLabel: 'Connection Problem' },
    green: { color: '#52c41a', glow: '0 0 10px rgba(82, 196, 26, 0.95)', animation: 'none', defaultLabel: 'Connected' },
    'red-flash': { color: '#ff4d4f', glow: '0 0 12px rgba(255, 77, 79, 1)', animation: 'pb-led-blink-red 0.8s infinite', defaultLabel: 'Connection Lost' },
  };

  const cfg = configs[state] || configs.red;
  const displayLabel = label !== null ? label : cfg.defaultLabel;

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
      <style>{`
        @keyframes pb-led-blink-yellow {
          0%, 100% { opacity: 1; filter: drop-shadow(0 0 6px #faad14); }
          50% { opacity: 0.2; filter: none; }
        }
        @keyframes pb-led-blink-red {
          0%, 100% { opacity: 1; filter: drop-shadow(0 0 8px #ff4d4f); }
          50% { opacity: 0.15; filter: none; }
        }
      `}</style>
      <span
        title={displayLabel}
        style={{
          display: 'inline-block',
          width: size,
          height: size,
          borderRadius: '50%',
          backgroundColor: cfg.color,
          boxShadow: cfg.glow,
          border: '1px solid rgba(255,255,255,0.3)',
          animation: cfg.animation,
          flexShrink: 0,
        }}
      />
      {displayLabel && (
        <span style={{ fontSize: '11px', fontWeight: 600, color: cfg.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {displayLabel}
        </span>
      )}
    </div>
  );
}
