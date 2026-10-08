import React, { useEffect, useRef, useState } from 'react';
import { fetchNotificationDestinations, changeNotificationDestination } from '../lib/cloud-api.js';

const CHANNELS = ['email', 'sms'];
const validDestination = value => typeof value?.verified === 'boolean' && Number.isSafeInteger(value.revision) && value.revision >= 0
  && (value.addressHint === null || typeof value.addressHint === 'string');

export function NotificationDestinations() {
  const [destinations, setDestinations] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = useRef(0);
  async function refresh() {
    const current = ++request.current;
    setLoading(true);
    setError('');
    try {
      const result = await fetchNotificationDestinations();
      if (!CHANNELS.every(channel => validDestination(result?.destinations?.[channel]))) throw new Error('invalid_destinations');
      if (current === request.current) setDestinations(result.destinations);
    } catch {
      if (current === request.current) setError('Contact verification status is unavailable. Refresh before making changes.');
    } finally { if (current === request.current) setLoading(false); }
  }
  useEffect(() => { refresh(); return () => { request.current++; }; }, []);
  return <section className="pb-stack" aria-label="Verified notification contacts">
    <h2>Notification contacts</h2>
    <p className="pb-muted">Verify where you want alerts to go. Contact verification does not establish that automated alert delivery is connected.</p>
    {loading && <p role="status">Loading contact verification status…</p>}
    {error && <div className="pb-callout danger" role="alert"><div><p>{error}</p><button className="pb-btn" type="button" onClick={refresh} disabled={loading}>Refresh contact status</button></div></div>}
    {destinations && CHANNELS.map(channel => <Contact key={channel} channel={channel} destination={destinations[channel]}
      unavailable={loading || Boolean(error)} refresh={refresh}
      update={next => { if (validDestination(next)) setDestinations(previous => ({ ...previous, [channel]: next })); }} />)}
  </section>;
}

function Contact({ channel, destination, unavailable, refresh, update }) {
  const [phone, setPhone] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const label = channel === 'email' ? 'Email' : 'SMS';
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  function rememberChallenge(result) {
    if (!/^[a-f0-9-]{36}$/.test(result?.challengeId || '') || !validDestination(result.destination)) return false;
    update(result.destination);
    setChallenge({ id: result.challengeId, expiresAt: result.expiresAt });
    setCode('');
    setPhone('');
    return true;
  }

  async function act(action) {
    if (busy || unavailable) return;
    if (action === 'request' && channel === 'sms' && !/^\+[1-9]\d{7,14}$/.test(phone.trim())) {
      setError('Enter a phone number in E.164 format, such as +15551234567.');
      return;
    }
    if (action === 'verify' && (!challenge?.id || !/^\d{8}$/.test(code))) {
      setError('Enter the eight-digit code for this verification request.');
      return;
    }
    const body = { action, channel,
      ...(action === 'request' && channel === 'sms' ? { phone: phone.trim() } : {}),
      ...(action === 'verify' ? { challengeId: challenge.id, code } : {}),
    };
    setBusy(true);
    setError('');
    setNotice('');
    if (action === 'verify') setCode('');
    try {
      const result = await changeNotificationDestination(body);
      if (!mounted.current) return;
      if (action === 'request') {
        if (result.deliveryStatus !== 'accepted' || !rememberChallenge(result)) throw new Error('invalid_request_response');
        setNotice('Verification request accepted by the provider. Delivery is not yet confirmed.');
      } else {
        if (!validDestination(result.destination) || (action === 'verify' && !result.destination.verified)) throw new Error('invalid_destination_response');
        update(result.destination);
        setChallenge(null);
        setCode('');
        setPhone('');
        setNotice(action === 'verify' ? `${label} contact verified. Automated alert delivery still requires configuration.` : `${label} contact revoked. It will not receive new alerts.`);
      }
    } catch (failure) {
      if (!mounted.current) return;
      const reason = failure.data?.error;
      if (reason === 'verification_delivery_unconfigured') {
        setError('Verification delivery is not configured. No verification message was sent. You can retry when the service is connected.');
      } else if (failure.data?.deliveryStatus === 'unknown' && rememberChallenge(failure.data)) {
        setError('Verification delivery status is unknown. If a code arrives, you can enter it below.');
      } else if (failure.data?.deliveryStatus === 'rejected') {
        if (validDestination(failure.data.destination)) update(failure.data.destination);
        setChallenge(null);
        setError('The provider rejected the verification request. Retry after checking your contact details.');
      } else {
        const messages = {
          incorrect_verification_code: 'That verification code is incorrect. Try the eight-digit code from this request.',
          verification_rate_limited: 'Too many verification requests. Wait before requesting another code.',
          verification_attempts_exhausted: 'No verification attempts remain. Request a new code when the request limit allows.',
          verification_unavailable: 'This verification request expired or was replaced. Request a new code.',
          account_contact_changed: 'Your account email changed. Request a new code for your current account email.',
          account_contact_missing: 'Your signed-in account needs a valid email address before email verification.',
          invalid_phone: 'Enter a phone number in E.164 format, such as +15551234567.',
        };
        if (['verification_unavailable', 'verification_attempts_exhausted', 'account_contact_changed'].includes(reason)) setChallenge(null);
        setError(messages[reason] || 'Could not confirm this action. Contact status is being refreshed; retry when it is available.');
        await refresh();
      }
    } finally { if (mounted.current) setBusy(false); }
  }

  return <article className="pb-card" aria-label={`${label} contact`}>
    <div className="pb-card-head"><h3>{label}</h3><span>{unavailable ? 'Status unavailable' : destination.verified ? 'Verified contact' : 'Not verified'}</span></div>
    {destination.addressHint && <p className="pb-mono">{destination.addressHint}</p>}
    {channel === 'email' ? <p>The code is requested for your signed-in account email. A different email cannot be submitted here.</p> :
      <label className="pb-field"><span>Mobile number (E.164)</span><input type="tel" autoComplete="off" placeholder="+15551234567" value={phone} disabled={busy || unavailable} onChange={event => setPhone(event.target.value)} /></label>}
    {destination.verified && <p className="pb-muted">Requesting another code replaces the current verification.</p>}
    <div className="pb-inline">
      <button type="button" className="pb-btn" disabled={busy || unavailable} onClick={() => act('request')}>{busy ? 'Working…' : `Request ${label} code`}</button>
      {(destination.addressHint || challenge) && <button type="button" className="pb-btn" disabled={busy || unavailable} onClick={() => act('revoke')}>Revoke {label} contact</button>}
    </div>
    {challenge && <form onSubmit={event => { event.preventDefault(); act('verify'); }} style={{ marginTop: 16 }}>
      <label className="pb-field"><span>Verification request ID</span><input value={challenge.id} readOnly autoComplete="off" className="pb-mono" /></label>
      <label className="pb-field"><span>{label} verification code</span><input value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" autoComplete="off" pattern="[0-9]{8}" maxLength={8} disabled={busy || unavailable} /></label>
      <p className="pb-muted">The code expires after ten minutes. The request and code are kept only in this open page.</p>
      <button type="submit" className="pb-btn pb-btn-primary" disabled={busy || unavailable || !/^\d{8}$/.test(code)}>Verify {label} contact</button>
    </form>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </article>;
}
