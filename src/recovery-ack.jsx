import React from 'react';
import { RECOVERY_ACK_ITEMS } from './data/recovery-acknowledgments.js';

const LEVEL_FLAG = Object.freeze({
  red: 'Immediate attention',
  amber: 'Capture beforehand',
  green: 'Respawns automatically',
});

/**
 * Signup acknowledgment table — every item a capsule cannot recover, shaded by
 * what happens at restore. Red/amber rows carry a required checkbox; green rows
 * are informational (the new project respawns them).
 */
export function RecoveryAcknowledgments({ checked, onToggle }) {
  return (
    <div className="ack-wrap">
      <p className="ack-lead">
        Before you create the account — the honest boundary. The capsule covers the database,
        Storage object bytes, Edge Functions, and the Auth inventory. These items live outside it:
      </p>
      <div className="ack-scroll">
        <table className="ack-table">
          <thead>
            <tr>
              <th>Outside the capsule</th>
              <th>At restore</th>
              <th>Do beforehand</th>
              <th className="ack-col-check">Acknowledge</th>
            </tr>
          </thead>
          <tbody>
            {RECOVERY_ACK_ITEMS.map((row) => (
              <tr key={row.key} className={`ack-${row.level}`}>
                <td>
                  <b>{row.item}</b>
                  <span className={`ack-flag ack-flag-${row.level}`}>{LEVEL_FLAG[row.level]}</span>
                </td>
                <td>{row.restore}</td>
                <td>
                  {row.capture}
                  {row.docsHref ? <> <a href={row.docsHref}>Step-by-step how-to</a></> : null}
                </td>
                <td className="ack-check">
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
            ))}
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
