import React, { useEffect, useRef, useState } from 'react';
import { fetchNotificationHistory } from '../lib/cloud-api.js';

const EVENTS = {
  'backup.completed': 'Backup finished',
  'backup.failed': 'Backup needs attention',
  'verify.failed': 'Verification needs attention',
  'verify.completed': 'Verification checks finished',
  'schedule.missed': 'Scheduled backup missed',
  'restore.completed': 'Restore finished',
  'restore.failed': 'Restore needs attention',
};
const RECEIPTS = {
  delivered: ['Delivered', 'The provider reported delivery. This does not confirm that the recipient read the message.'],
  failed: ['Delivery failed', 'The provider reported that delivery failed.'],
  conflicted: ['Delivery uncertain', 'Conflicting provider receipts prevent confirmation of delivery.'],
  sent: ['Sent by provider', 'The provider reported sending the message. Delivery is not confirmed.'],
  accepted: ['Accepted by provider', 'The provider accepted the message. Delivery is not confirmed.'],
};
const STATES = {
  pending: ['Pending', 'The notification is waiting for dispatch.'],
  leased: ['Preparing to send', 'A worker claimed the notification. Delivery is not confirmed.'],
  sending: ['Dispatch in progress', 'A send attempt started. Its outcome is not confirmed.'],
  accepted: RECEIPTS.accepted,
  suppressed: ['Suppressed', 'The notification was withheld by the delivery checks.'],
  rejected: ['Rejected by provider', 'The provider rejected the send attempt.'],
  unknown: ['Delivery uncertain', 'The send outcome is unknown. Delivery cannot be confirmed.'],
};
const validDate = value => value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
function validHistory(value) {
  return typeof value?.truncated === 'boolean' && Array.isArray(value.deliveries) && value.deliveries.every(row =>
    row && typeof row.id === 'string' && row.id.length > 0 && typeof row.eventType === 'string'
    && ['email', 'sms'].includes(row.channel) && typeof row.state === 'string'
    && (row.deliveryStatus === null || typeof row.deliveryStatus === 'string')
    && ['createdAt', 'updatedAt', 'lastReceiptAt'].every(key => validDate(row[key])));
}
function timestamp(value) {
  return value ? new Date(value).toLocaleString() : 'Not recorded';
}

export function NotificationHistory() {
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const request = useRef(0);
  async function refresh() {
    const current = ++request.current;
    setLoading(true);
    setError(false);
    setHistory(null);
    try {
      const result = await fetchNotificationHistory();
      if (!validHistory(result)) throw new Error('invalid_notification_history');
      if (current === request.current) setHistory(result);
    } catch {
      if (current === request.current) setError(true);
    } finally { if (current === request.current) setLoading(false); }
  }
  useEffect(() => { refresh(); return () => { request.current++; }; }, []);

  return <section className="pb-stack" aria-label="Notification delivery history">
    <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
      <h2>Delivery history</h2>
      <button type="button" className="pb-btn" disabled={loading} onClick={refresh}>{error ? 'Retry delivery history' : 'Refresh delivery history'}</button>
    </div>
    <p className="pb-muted">Recorded email and SMS notification outcomes. Provider acceptance alone does not confirm delivery.</p>
    {loading && <p role="status">Loading delivery history…</p>}
    {error && <div className="pb-callout danger" role="alert"><p>Delivery history is unavailable. Retry to check recorded outcomes.</p></div>}
    {history?.truncated && <div className="pb-callout warn" role="status"><p>This history is incomplete. Additional records may exist beyond those shown.</p></div>}
    {history && history.deliveries.length === 0 && <p>No notification deliveries are recorded in this result. This does not confirm that alerts are connected or that backups are healthy.</p>}
    {history?.deliveries.map(row => {
      const receipt = Object.hasOwn(RECEIPTS, row.deliveryStatus) ? RECEIPTS[row.deliveryStatus] : null;
      const state = Object.hasOwn(STATES, row.state) ? STATES[row.state] : STATES.unknown;
      const [label, detail] = row.deliveryStatus && !receipt ? STATES.unknown : receipt || state;
      const event = Object.hasOwn(EVENTS, row.eventType) ? EVENTS[row.eventType] : 'Runner notification';
      return <article className="pb-card" key={row.id} aria-label={`${row.channel === 'email' ? 'Email' : 'SMS'}: ${event}`}>
        <div className="pb-card-head" style={{ flexWrap: 'wrap', gap: 8 }}><h3>{event}</h3><span>{row.channel === 'email' ? 'Email' : 'SMS'}</span></div>
        <p><strong>{label}</strong></p><p>{detail}</p>
        <p className="pb-muted">Created: {timestamp(row.createdAt)}<br />Updated: {timestamp(row.updatedAt)}<br />Last provider receipt: {timestamp(row.lastReceiptAt)}</p>
      </article>;
    })}
  </section>;
}
