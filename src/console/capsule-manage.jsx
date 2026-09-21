import React, { useMemo, useState } from 'react';
import { Icon } from './icons.jsx';
import { BarGauge, RingGauge, StatusPip } from './gauges.jsx';
import { formatBytes, formatDuration, relativeTime, uid } from './data/store.js';
import {
  CAPSULE_KEY_MIN_LENGTH,
  cliInjectHint,
  downloadJson,
  injectKeyLocally,
  loadKeyRecords,
  neverSendFields,
  recordForCapsule,
  wrapPassphraseForDownload,
} from '../lib/capsule-key.js';
import {
  ADDON_TRANSFERS_PER_24H,
  BASE_TRANSFERS_PER_24H,
  TRANSFER_WINDOW_HOURS,
  getCloudPlan,
  minScheduleHours,
  storageUsage,
} from '../lib/product.js';
import { TransferWindowPanel } from './transfer-window.jsx';

function Badge({ tone, children }) {
  const t = tone === 'ok' || tone === 'COMPLETE' || tone === 'injected-local' || tone === 'verified'
    ? 'ok'
    : tone === 'warn' || tone === 'PENDING' || tone === 'awaiting'
      ? 'warn'
      : tone === 'danger' || tone === 'FAILED'
        ? 'danger'
        : tone === 'acid' ? 'acid' : tone === 'info' ? 'info' : '';
  return <span className={`pb-badge${t ? ` pb-badge-${t}` : ''}`}>{children}</span>;
}

function Modal({ title, children, onClose, footer, large }) {
  return (
    <div className="pb-modal-backdrop" onClick={onClose} role="presentation">
      <div className={`pb-modal${large ? ' pb-modal-lg' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="pb-modal-head">
          <h2>{title}</h2>
          <button type="button" className="pb-btn pb-btn-icon pb-btn-ghost" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <div className="pb-modal-body">{children}</div>
        {footer && <div className="pb-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

function rescueState(capsule) {
  if (capsule.status === 'COMPLETE' && capsule.verified) return { tone: 'ok', label: 'Replay-ready' };
  if (capsule.status === 'COMPLETE' && !capsule.verified) return { tone: 'warn', label: 'Needs verify' };
  if (capsule.status === 'FAILED') return { tone: 'danger', label: 'Not restorable' };
  return { tone: 'info', label: 'Pending' };
}

export function KeyInjectModal({ capsule, onClose, toast }) {
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [record, setRecord] = useState(() => recordForCapsule(capsule.id));

  const resetSecrets = () => {
    setPassphrase('');
    setConfirm('');
    setPin('');
  };

  const inject = async () => {
    if (passphrase !== confirm) return toast('Passphrases do not match', 'danger');
    setBusy(true);
    try {
      const next = await injectKeyLocally({ capsuleId: capsule.id, passphrase, method: 'browser-local' });
      setRecord(next);
      resetSecrets();
      toast('Key injected locally — Cloud never received it', 'ok');
    } catch (err) {
      toast(err.message || 'Could not inject key', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const downloadWrap = async () => {
    if (passphrase !== confirm) return toast('Passphrases do not match', 'danger');
    setBusy(true);
    try {
      const wrap = await wrapPassphraseForDownload({ passphrase, pin, capsuleId: capsule.id });
      downloadJson(`portabase-keywrap-${capsule.id}.json`, wrap);
      await injectKeyLocally({ capsuleId: capsule.id, passphrase, method: 'browser-wrap-file' });
      setRecord(recordForCapsule(capsule.id));
      resetSecrets();
      toast('Wrap file downloaded to this computer only', 'ok');
    } catch (err) {
      toast(err.message || 'Could not wrap key', 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      large
      title="Inject capsule key"
      onClose={() => { resetSecrets(); onClose(); }}
      footer={
        <>
          <button type="button" className="pb-btn" onClick={() => { resetSecrets(); onClose(); }}>Close</button>
          <button type="button" className="pb-btn" disabled={busy || !pin} onClick={downloadWrap}>Download local wrap</button>
          <button type="button" className="pb-btn pb-btn-primary" disabled={busy} onClick={inject}>
            {busy ? 'Working…' : 'Inject on this device'}
          </button>
        </>
      }
    >
      <div className="pb-callout danger">
        <Icon name="shield" size={16} />
        <div>
          <strong>Browser seals to your runner — never posted to Portabase servers</strong>
          <p>
            The passphrase seals the capsule on <em>your</em> browser or runner.
            We do not upload it, store it, or learn it. Cloud may later see a boolean “key present” from your agent — never the secret.
            Designed and tested in this repo — not a third-party proven-green audit.
          </p>
        </div>
      </div>
      <p className="pb-muted" style={{ marginTop: 0, fontSize: 13 }}>
        This is <strong>not</strong> a content browser. You cannot list tables or objects from this site.
        You are only attaching the customer key used to encrypt / wrap the capsule.
      </p>
      <div className="pb-field">
        <label>Passphrase (≥{CAPSULE_KEY_MIN_LENGTH} characters)</label>
        <input type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
      </div>
      <div className="pb-field">
        <label>Confirm passphrase</label>
        <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      <div className="pb-field">
        <label>Optional wrap PIN (download a sealed file for the runner)</label>
        <input type="password" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Same length rule as the passphrase" />
        <span className="pb-field-hint">PIN + wrap file stay on this computer. Unlock only on your CLI runner.</span>
      </div>
      <div className="pb-code" style={{ marginBottom: 12 }}>{cliInjectHint(capsule.id)}</div>
      <ul className="pb-muted" style={{ paddingLeft: 18, fontSize: 12.5, lineHeight: 1.55 }}>
        {neverSendFields().map((item) => <li key={item}>Never sent: {item}</li>)}
      </ul>
      {record && (
        <div className="pb-callout ok" style={{ marginTop: 12 }}>
          <Icon name="key" size={16} />
          <div>
            <strong>Local fingerprint {record.fingerprintShort}</strong>
            <p>Injected {relativeTime(record.injectedAt)} · {record.method}. This hint is stored in this browser only.</p>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function CapsuleManagePage({ state, setState, toast, navigate, embedded, me, startAddon, busy }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState(null);
  const [injectFor, setInjectFor] = useState(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [form, setForm] = useState({
    projectId: state.projects[0]?.id || '',
    destinationId: state.destinations[0]?.id || '',
    retainDays: 30,
    everyHours: minScheduleHours({ extraTransfersAddon: Boolean(state.billing?.extraTransfersAddon) }),
  });
  const keys = loadKeyRecords();
  const plan = getCloudPlan(state.billing?.planId || state.billing?.plan);
  const usedBytes = state.capsules.reduce((sum, c) => sum + (Number(c.sizeBytes) || 0), 0);
  const usage = storageUsage(usedBytes, plan.id);

  const list = useMemo(() => state.capsules.filter((c) => {
    if (status !== 'all' && c.status !== status) return false;
    if (q && !`${c.id} ${c.projectRef} ${c.destinationKind}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [state.capsules, q, status]);

  const register = () => {
    const project = state.projects.find((p) => p.id === form.projectId);
    const dest = state.destinations.find((d) => d.id === form.destinationId);
    if (!project || !dest) return toast('Pick a source and destination', 'danger');
    setState((s) => {
      s.capsules.unshift({
        id: uid('cap'),
        projectId: project.id,
        projectRef: project.ref,
        status: 'PENDING',
        verified: false,
        destinationId: dest.id,
        destinationKind: dest.kind,
        sizeBytes: 0,
        durationMs: null,
        createdAt: new Date().toISOString(),
        edition: 'community',
        layers: { ...project.layers },
        rpoHours: null,
        retainDays: Number(form.retainDays) || 30,
        scheduleEveryHours: Number(form.everyHours) || minScheduleHours({ extraTransfersAddon: Boolean(state.billing?.extraTransfersAddon) }),
        registered: true,
      });
      s.events.unshift({
        id: uid('evt'),
        type: 'capsule.registered',
        projectRef: project.ref,
        agentId: null,
        occurredAt: new Date().toISOString(),
        summary: 'Capsule registered · awaiting runner seal',
        level: 'info',
      });
      return s;
    });
    setRegisterOpen(false);
    toast('Capsule registered — runner must still inject the key and capture', 'ok');
  };

  const updateCapsule = (id, patch) => {
    setState((s) => {
      const row = s.capsules.find((c) => c.id === id);
      if (row) Object.assign(row, patch);
      return s;
    });
  };

  const selectedCapsule = state.capsules.find((c) => c.id === selected);

  const body = (
    <>
      <div className="pb-callout info">
        <Icon name="capsule" size={16} />
        <div>
          <strong>Management only — Cloud is blind to keys and capsule bytes</strong>
          <p>
            Register, schedule, verify, retain, choose a destination type, and inject the seal key on your side.
            Single cryptographic entry: your secret only — Portabase never holds a second key.
            Cloud cannot see object names or capsule plaintext. There is no server-side decrypt path.
          </p>
        </div>
      </div>

      <TransferWindowPanel state={state} me={me} onUpgrade={startAddon} busy={busy} navigate={navigate} />

      <div className="pb-grid pb-grid-3" style={{ marginBottom: 16 }}>
        <div className="pb-card">
          <RingGauge
            value={state.capsules.length ? (state.capsules.filter((c) => c.verified).length / state.capsules.length) * 100 : 0}
            label="Verify health"
            detail={`${state.capsules.filter((c) => c.verified).length} verified capsules`}
            tone="ok"
            mocked
          />
        </div>
        <div className="pb-card">
          <RingGauge
            value={state.capsules.length ? (state.capsules.filter((c) => rescueState(c).tone === 'ok').length / state.capsules.length) * 100 : 0}
            label="Rescue readiness"
            detail="COMPLETE + verify-green"
            tone="ok"
            mocked
          />
        </div>
        <div className="pb-card">
          <BarGauge
            used={usage.usedBytes}
            cap={usage.capBytes}
            label={`${plan.title} usage`}
            usedLabel={formatBytes(usage.usedBytes)}
            capLabel={usage.capLabel}
            tone={usage.percent > 85 ? 'warn' : 'ok'}
            mocked
          />
          <p className="pb-faint" style={{ margin: '10px 0 0', fontSize: 12 }}>
            Plan cap is telemetry against {plan.shortLabel}. The vault is still yours — we do not host these bytes.
          </p>
        </div>
      </div>

      <div className="pb-inline" style={{ marginBottom: 14 }}>
        <div className="pb-search" style={{ minWidth: 220 }}>
          <Icon name="search" size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter capsule id / dest…" />
        </div>
        <select className="pb-btn" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="COMPLETE">COMPLETE</option>
          <option value="PENDING">PENDING</option>
          <option value="FAILED">FAILED</option>
        </select>
        <button type="button" className="pb-btn pb-right" onClick={() => navigate?.('inspect')}>
          <Icon name="key" size={14} /> Open locally
        </button>
        <button type="button" className="pb-btn pb-btn-primary" onClick={() => setRegisterOpen(true)}>
          <Icon name="plus" size={14} /> Register capsule
        </button>
      </div>

      <div className="pb-table-wrap">
        <table className="pb-table">
          <thead>
            <tr>
              <th>Capsule</th>
              <th>Status</th>
              <th>Verify</th>
              <th>Rescue</th>
              <th>Key</th>
              <th>Destination</th>
              <th>Retention</th>
              <th>When</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={9} className="pb-muted">No capsules registered yet.</td></tr>}
            {list.map((c) => {
              const dest = state.destinations.find((d) => d.id === c.destinationId);
              const key = keys.find((k) => k.capsuleId === c.id);
              const rescue = rescueState(c);
              return (
                <tr key={c.id}>
                  <td className="mono">{c.id}</td>
                  <td><Badge tone={c.status}>{c.status}</Badge></td>
                  <td><Badge tone={c.verified ? 'ok' : 'warn'}>{c.verified ? 'green' : 'unverified'}</Badge></td>
                  <td><StatusPip tone={rescue.tone} label={rescue.label} /></td>
                  <td><Badge tone={key ? 'ok' : 'warn'}>{key ? key.fingerprintShort : 'no local key'}</Badge></td>
                  <td>{dest?.name || c.destinationKind}</td>
                  <td className="mono">{c.retainDays || 30}d</td>
                  <td className="mono">{relativeTime(c.createdAt)}</td>
                  <td>
                    <button type="button" className="pb-btn pb-btn-sm" onClick={() => setSelected(c.id)}>Manage</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="pb-faint" style={{ marginTop: 10, fontSize: 12 }}>
        Size shown in other views is ciphertext length only — not a listing of objects inside the capsule.
      </p>

      {registerOpen && (
        <Modal
          title="Register a capsule"
          onClose={() => setRegisterOpen(false)}
          footer={(
            <>
              <button type="button" className="pb-btn" onClick={() => setRegisterOpen(false)}>Cancel</button>
              <button type="button" className="pb-btn pb-btn-primary" onClick={register}>Register</button>
            </>
          )}
        >
          <p className="pb-field-hint">Creates a management record. Capture still happens on the runner after you inject a key locally.</p>
          <div className="pb-field">
            <label>Source project</label>
            <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
              {state.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="pb-field">
            <label>Destination</label>
            <select value={form.destinationId} onChange={(e) => setForm({ ...form, destinationId: e.target.value })}>
              {state.destinations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="pb-field">
            <label>Schedule every (hours)</label>
            <input type="number" min={minScheduleHours({ extraTransfersAddon: Boolean(state.billing?.extraTransfersAddon) })} value={form.everyHours} onChange={(e) => setForm({ ...form, everyHours: e.target.value })} />
            <span className="pb-field-hint">Included: {BASE_TRANSFERS_PER_24H} / {TRANSFER_WINDOW_HOURS}h. Add-on: up to {ADDON_TRANSFERS_PER_24H}.</span>
          </div>
          <div className="pb-field">
            <label>Retention (days)</label>
            <input type="number" min={1} value={form.retainDays} onChange={(e) => setForm({ ...form, retainDays: e.target.value })} />
          </div>
        </Modal>
      )}

      {selectedCapsule && (
        <Modal
          large
          title={`Manage ${selectedCapsule.id}`}
          onClose={() => setSelected(null)}
          footer={<button type="button" className="pb-btn" onClick={() => setSelected(null)}>Close</button>}
        >
          <div className="pb-grid pb-grid-2">
            <div className="pb-card">
              <div className="pb-kpi-label">Status</div>
              <div className="pb-inline" style={{ marginTop: 8 }}>
                <Badge tone={selectedCapsule.status}>{selectedCapsule.status}</Badge>
                <Badge tone={selectedCapsule.verified ? 'ok' : 'warn'}>{selectedCapsule.verified ? 'verified' : 'unverified'}</Badge>
              </div>
              <p className="pb-muted" style={{ marginTop: 10, fontSize: 12.5 }}>
                Last report {relativeTime(selectedCapsule.createdAt)} · {formatBytes(selectedCapsule.sizeBytes)} ciphertext · {formatDuration(selectedCapsule.durationMs)}
              </p>
            </div>
            <div className="pb-card">
              <div className="pb-kpi-label">Key injection</div>
              <p className="pb-muted" style={{ fontSize: 12.5 }}>
                {recordForCapsule(selectedCapsule.id)
                  ? `Local fingerprint ${recordForCapsule(selectedCapsule.id).fingerprintShort}`
                  : 'No key on this browser. Inject locally or on the CLI.'}
              </p>
              <button type="button" className="pb-btn pb-btn-primary" style={{ marginTop: 10 }} onClick={() => setInjectFor(selectedCapsule)}>
                <Icon name="key" size={14} /> Inject / rotate key
              </button>
            </div>
          </div>
          <div className="pb-field" style={{ marginTop: 16 }}>
            <label>Destination</label>
            <select
              value={selectedCapsule.destinationId || ''}
              onChange={(e) => {
                const dest = state.destinations.find((d) => d.id === e.target.value);
                updateCapsule(selectedCapsule.id, { destinationId: dest?.id, destinationKind: dest?.kind });
                toast('Destination label updated — credentials stay on the runner', 'ok');
              }}
            >
              {state.destinations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="pb-field">
            <label>Retention (days)</label>
            <input
              type="number"
              min={1}
              defaultValue={selectedCapsule.retainDays || 30}
              onBlur={(e) => {
                updateCapsule(selectedCapsule.id, { retainDays: Number(e.target.value) || 30 });
                toast('Retention saved', 'ok');
              }}
            />
          </div>
          <div className="pb-field">
            <label>Schedule every (hours)</label>
            <input
              type="number"
              min={minScheduleHours({ extraTransfersAddon: Boolean(state.billing?.extraTransfersAddon) })}
              defaultValue={selectedCapsule.scheduleEveryHours || minScheduleHours({ extraTransfersAddon: Boolean(state.billing?.extraTransfersAddon) })}
              onBlur={(e) => {
                const minH = minScheduleHours({ extraTransfersAddon: Boolean(state.billing?.extraTransfersAddon) });
                const hours = Math.max(minH, Number(e.target.value) || minH);
                updateCapsule(selectedCapsule.id, { scheduleEveryHours: hours });
                toast(hours < 24 && !state.billing?.extraTransfersAddon
                  ? 'Schedule saved — Extra transfers add-on required for more than 1 / 24h'
                  : 'Schedule expectation saved', 'ok');
              }}
            />
          </div>
          <div className="pb-inline">
            <button
              type="button"
              className="pb-btn"
              onClick={() => {
                updateCapsule(selectedCapsule.id, { verified: true });
                toast('Verify intent queued for the worker — Cloud does not open the capsule', 'ok');
              }}
            >
              Queue verify
            </button>
            <button type="button" className="pb-btn" onClick={() => navigate?.('restore')}>Open Replay</button>
          </div>
        </Modal>
      )}

      {injectFor && (
        <KeyInjectModal
          capsule={injectFor}
          toast={toast}
          onClose={() => setInjectFor(null)}
        />
      )}
    </>
  );

  if (embedded) return body;
  return (
    <>
      <div className="pb-page-head">
        <div>
          <h1>Capsules</h1>
          <p>Manage sealed archives on your destinations. Inject keys on this device or the CLI. Cloud never learns the passphrase.</p>
        </div>
      </div>
      {body}
    </>
  );
}
