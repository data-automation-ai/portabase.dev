import React, { useState } from 'react';
import { RECOVERY_ACK_ITEMS } from './data/recovery-acknowledgments.js';

const LEVEL_FLAG = Object.freeze({
  red: 'Immediate attention',
  amber: 'Capture beforehand',
  green: 'Respawns automatically',
});

/**
 * Signup acknowledgment table — grouped by Common vs. Less Common secrets.
 * Non-technical, friendly explanation of one-way hash storage and step-by-step navigation.
 */
export function RecoveryAcknowledgments({ checked, onToggle }) {
  const [filterGroup, setFilterGroup] = useState('all');

  const commonItems = RECOVERY_ACK_ITEMS.filter((i) => i.group === 'common');
  const lessCommonItems = RECOVERY_ACK_ITEMS.filter((i) => i.group === 'less-common');
  const autoItems = RECOVERY_ACK_ITEMS.filter((i) => i.group === 'automatic');

  const displayedItems = filterGroup === 'common'
    ? commonItems
    : filterGroup === 'less-common'
      ? lessCommonItems
      : filterGroup === 'automatic'
        ? autoItems
        : RECOVERY_ACK_ITEMS;

  const renderRow = (row) => (
    <tr key={row.key} className={`ack-${row.level}`}>
      <td style={{ minWidth: '180px' }}>
        <b>{row.item}</b>
        <span className={`ack-flag ack-flag-${row.level}`}>{LEVEL_FLAG[row.level]}</span>
        {row.group === 'common' && (
          <span style={{ display: 'inline-block', fontSize: '10px', color: '#388bfd', marginLeft: '6px', fontWeight: 600 }}>★ Common</span>
        )}
        {row.group === 'less-common' && (
          <span style={{ display: 'inline-block', fontSize: '10px', color: '#8b949e', marginLeft: '6px' }}>Less Common</span>
        )}
      </td>
      <td style={{ minWidth: '180px', color: '#c9d1d9' }}>{row.restore}</td>
      <td style={{ minWidth: '240px' }}>
        <div style={{ color: '#e6edf3', marginBottom: '8px' }}>{row.capture}</div>
        {Array.isArray(row.steps) && row.steps.length > 0 && (
          <div style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '8px 10px', marginTop: '6px' }}>
            <span style={{ fontSize: '11px', color: '#58a6ff', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
              📍 How to find or rotate this in Supabase:
            </span>
            <ol style={{ margin: 0, paddingLeft: '16px', fontSize: '11px', color: '#8b949e', lineHeight: '1.5' }}>
              {row.steps.map((s, idx) => (
                <li key={idx} style={{ marginBottom: '2px' }}>{s.replace(/^[0-9]+\.\s*/, '')}</li>
              ))}
            </ol>
          </div>
        )}
        {row.docsHref ? (
          <div style={{ marginTop: '6px' }}>
            <a href={row.docsHref} style={{ fontSize: '11.5px', color: '#58a6ff' }}>Step-by-step how-to ↗</a>
          </div>
        ) : null}
      </td>
      <td className="ack-check" style={{ minWidth: '160px' }}>
        {row.ack ? (
          <label>
            <input
              type="checkbox"
              checked={checked.has(row.key)}
              onChange={() => onToggle(row.key)}
            />
            <span>{row.ack}</span>
          </label>
        ) : (
          <span className="ack-auto">Nothing to do</span>
        )}
      </td>
    </tr>
  );

  return (
    <div className="ack-wrap">
      
      {/* Friendly Non-Technical Explainer Card */}
      <div style={{
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: '8px',
        padding: '16px 18px',
        marginBottom: '16px',
        lineHeight: 1.5,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <span style={{ fontSize: '18px' }}>💡</span>
          <strong style={{ fontSize: '14px', color: '#f0f6fc' }}>
            Why do I need to gather these secrets? (A quick 2-minute safety check)
          </strong>
        </div>
        <p style={{ fontSize: '12.5px', color: '#8b949e', margin: '0 0 10px' }}>
          When you enter passwords, API keys, or provider secrets into Supabase, the system immediately converts them into a cryptographic <strong>one-way hash</strong> (like an irreversible digital fingerprint). Supabase never stores your readable text on their servers.
        </p>
        <p style={{ fontSize: '12.5px', color: '#8b949e', margin: '0 0 10px' }}>
          Because of this security design, <strong>no automated backup or data transfer tool on earth can extract these values for you</strong>. When an API call or login occurs, Supabase can only test the entered secret against the hash to see if it is <strong>True or False</strong>.
        </p>
        <p style={{ fontSize: '12.5px', color: '#3ecf8e', margin: 0, fontWeight: 500 }}>
          <strong>The easiest and safest move:</strong> The only chance you ever have to make a copy of a secret value is when you create it or rotate it. Take 2 minutes now to rotate any keys you do not know, and paste them into your Notepad or password manager.
        </p>
      </div>

      {/* Filter Tabs for Grouping: All vs Common vs Less Common */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            onClick={() => setFilterGroup('all')}
            style={{
              padding: '4px 10px',
              fontSize: '11px',
              borderRadius: '6px',
              border: filterGroup === 'all' ? '1px solid #388bfd' : '1px solid #30363d',
              background: filterGroup === 'all' ? '#1f6feb' : '#21262d',
              color: '#f0f6fc',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            All Items ({RECOVERY_ACK_ITEMS.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterGroup('common')}
            style={{
              padding: '4px 10px',
              fontSize: '11px',
              borderRadius: '6px',
              border: filterGroup === 'common' ? '1px solid #388bfd' : '1px solid #30363d',
              background: filterGroup === 'common' ? '#1f6feb' : '#21262d',
              color: '#f0f6fc',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            ★ Most Common ({commonItems.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterGroup('less-common')}
            style={{
              padding: '4px 10px',
              fontSize: '11px',
              borderRadius: '6px',
              border: filterGroup === 'less-common' ? '1px solid #388bfd' : '1px solid #30363d',
              background: filterGroup === 'less-common' ? '#1f6feb' : '#21262d',
              color: '#f0f6fc',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            ⚙ Less Common ({lessCommonItems.length})
          </button>
        </div>
        <span style={{ fontSize: '11.5px', color: '#8b949e' }}>
          Step-by-step click paths included below
        </span>
      </div>

      <div className="ack-scroll">
        <table className="ack-table">
          <thead>
            <tr>
              <th>Outside the capsule</th>
              <th>Why it cannot be backed up</th>
              <th>How to gather or rotate it beforehand</th>
              <th className="ack-col-check">Acknowledge</th>
            </tr>
          </thead>
          <tbody>
            {displayedItems.map(renderRow)}
          </tbody>
        </table>
      </div>

      <p className="ack-legend">
        <span><i className="ack-dot green" aria-hidden="true" /> Respawns on the new project</span>
        <span><i className="ack-dot amber" aria-hidden="true" /> Capture by hand beforehand</span>
        <span><i className="ack-dot red" aria-hidden="true" /> Record it right now — on paper if necessary</span>
      </p>
    </div>
  );
}

/** Local evidence of the acknowledgment (the checkbox gate is the enforcement). */
export function recordRecoveryAck(keys) {
  try {
    const list = keys instanceof Set ? [...keys] : keys;
    localStorage.setItem(
      'portabase.recovery-ack.v1',
      JSON.stringify({ at: new Date().toISOString(), keys: list }),
    );
  } catch { /* storage unavailable (private mode) — the gate still applies */ }
}
