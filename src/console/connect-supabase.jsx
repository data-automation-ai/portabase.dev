import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import { formatHumanSize } from '../lib/human-size.js';
import {
  cloudBackupCliCommand,
  normalizeSizeInventory,
  sampleSizeInventory,
  summarizeSelection,
} from '../lib/table-sizer.js';
import {
  describeCloudApiError,
  fetchCloudSelection,
  fetchSupabaseInventory,
  fetchSupabaseProjects,
  saveCloudSelection,
} from '../lib/cloud-api.js';
import { TableSizer } from './table-sizer.jsx';

const TOKENS_URL = 'https://supabase.com/dashboard/account/tokens';

const SAMPLE_PROJECTS = [
  { ref: 'kiuwcdpjsdotkoojbkoi', name: 'Primary app', region: 'us-east-1', status: 'ACTIVE_HEALTHY' },
  { ref: 'acmeprodxyzabcdefghij', name: 'Acme prod', region: 'us-west-2', status: 'ACTIVE_HEALTHY' },
];

function copyText(text, toast) {
  navigator.clipboard?.writeText(text)
    .then(() => toast?.('Copied to clipboard', 'ok'))
    .catch(() => toast?.('Could not copy', 'danger'));
}

const STEPS = [
  { id: 'connect', label: 'Connect Supabase' },
  { id: 'projects', label: 'Pick the database' },
  { id: 'select', label: 'Choose what to back up' },
  { id: 'save', label: 'Save' },
];

function ErrorBanner({ error }) {
  if (!error) return null;
  return (
    <div className="pb-callout danger" role="alert">
      <Icon name="warn" size={16} />
      <div>
        <strong>Could not continue</strong>
        <p>{error}</p>
      </div>
    </div>
  );
}

function StepRail({ step }) {
  const active = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="pb-wizard" aria-label="Connect Supabase steps">
      {STEPS.map((s, i) => (
        <li key={s.id} className={i === active ? 'is-active' : i < active ? 'is-done' : ''}>
          <span>{i + 1}</span>{s.label}
        </li>
      ))}
    </ol>
  );
}

/**
 * $7 Cloud guided flow: paste a Supabase Personal Access Token, pick the one
 * database `cloud-7` allows, measure it, choose what goes in the capsule,
 * and save the selection server-side. The token lives only in this
 * component's state — never localStorage/sessionStorage, never a URL.
 */
export function ConnectSupabaseFlow({ demo = false, plan, toast }) {
  const capBytes = plan?.storageCapBytes || 0;
  const capLabel = plan?.storageCapLabel || 'plan cap';
  const planId = plan?.id || 'cloud-7';
  const oneDatabaseOnly = plan?.databases === 1;

  const [step, setStep] = useState('connect');
  const [token, setToken] = useState('');
  const [projects, setProjects] = useState(null);
  const [selectedRef, setSelectedRef] = useState('');
  const [inventory, setInventory] = useState(null);
  const [selection, setSelection] = useState({});
  const [excludeBinaries, setExcludeBinaries] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(null); // { projectName, estimateBytes, capBytes, projectRef }
  const [savedLoading, setSavedLoading] = useState(!demo);
  const tokenRef = useRef('');
  tokenRef.current = token;

  const selectedProject = (projects || []).find((p) => p.ref === selectedRef) || null;

  // Clear the token from memory when the page is left.
  useEffect(() => () => { tokenRef.current = ''; }, []);

  // On load, show any already-saved selection instead of starting the flow cold.
  useEffect(() => {
    if (demo) { setSavedLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchCloudSelection();
        if (cancelled) return;
        if (data?.selection) {
          setSaved(data.selection);
          setStep('saved');
        }
      } catch (err) {
        if (!cancelled && err?.status !== 404) setError(describeCloudApiError(err));
      } finally {
        if (!cancelled) setSavedLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [demo]);

  const showProjects = async () => {
    setError('');
    if (!demo && !token.trim()) {
      setError("Paste your Supabase Personal Access Token first.");
      return;
    }
    setLoading(true);
    try {
      if (demo) {
        setProjects(SAMPLE_PROJECTS);
      } else {
        const data = await fetchSupabaseProjects(token.trim());
        setProjects(Array.isArray(data?.projects) ? data.projects : []);
      }
      setStep('projects');
    } catch (err) {
      setError(describeCloudApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const measureIt = async () => {
    if (!selectedRef) {
      setError('Pick a project first.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      if (demo) {
        setInventory(sampleSizeInventory());
      } else {
        const data = await fetchSupabaseInventory(token.trim(), selectedRef);
        setInventory(normalizeSizeInventory(data));
      }
      setSelection({});
      setStep('select');
    } catch (err) {
      setError(describeCloudApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const summary = inventory ? summarizeSelection(inventory, selection) : null;
  const overCap = Boolean(summary && capBytes && summary.includedBytes > capBytes);
  const cliCommand = cloudBackupCliCommand({
    excludeTables: summary?.omittedTables?.map((row) => row.key) || [],
    excludeBuckets: summary?.omittedBuckets?.map((row) => row.key) || [],
  });

  const save = async () => {
    if (!summary || overCap) return;
    setError('');
    setLoading(true);
    const payload = {
      version: 1,
      planId,
      projectRef: selectedRef,
      projectName: selectedProject?.name || selectedRef,
      excludeTables: summary.omittedTables.map((row) => row.key),
      excludeBuckets: summary.omittedBuckets.map((row) => row.key),
      estimateBytes: summary.includedBytes,
      capBytes,
      measuredAt: inventory?.capturedAt || new Date().toISOString(),
    };
    try {
      if (demo) {
        setSaved(payload);
        toast?.('Saved (demo — not sent to the server)', 'ok');
      } else {
        const data = await saveCloudSelection(payload);
        setSaved(data?.selection || payload);
        toast?.('Selection saved', 'ok');
      }
      setStep('saved');
    } catch (err) {
      setError(describeCloudApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const startOver = () => {
    setError('');
    setToken('');
    setProjects(null);
    setSelectedRef('');
    setInventory(null);
    setSelection({});
    setStep('connect');
  };

  if (savedLoading) {
    return (
      <div className="pb-card" role="status">
        <p className="pb-muted" style={{ margin: 0 }}>Checking for a saved selection…</p>
      </div>
    );
  }

  if (step === 'saved' && saved) {
    return (
      <div className="pb-stack">
        {demo && (
          <div className="pb-sample-banner" role="status">
            <span className="pb-sample-chip">SAMPLE</span>
            <strong>Demo workspace</strong>
            <p>This selection was not sent to the server.</p>
          </div>
        )}
        <div className="pb-card">
          <div className="pb-card-head">
            <h3>Saved selection</h3>
            <span>{planId}</span>
          </div>
          <p className="pb-muted" style={{ marginTop: 0 }}>
            Saved selection: <strong>{saved.projectName || saved.projectRef}</strong>,{' '}
            {formatHumanSize(saved.estimateBytes)} of {formatHumanSize(saved.capBytes || capBytes) || capLabel}.
          </p>
          <button type="button" className="pb-btn pb-btn-primary" onClick={startOver}>Edit</button>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-stack pb-connect-supabase">
      {demo && (
        <div className="pb-sample-banner" role="status">
          <span className="pb-sample-chip">SAMPLE</span>
          <strong>Demo workspace</strong>
          <p>Sample projects and sizes — nothing is sent to Supabase or saved on the server.</p>
        </div>
      )}
      <StepRail step={step} />
      <ErrorBanner error={error} />

      {step === 'connect' && (
        <div className="pb-card" style={{ maxWidth: 640 }}>
          <h3 style={{ marginTop: 0 }}>Connect Supabase</h3>
          <div className="pb-field">
            <label htmlFor="pat-token">Supabase Personal Access Token</label>
            <input
              id="pat-token"
              type="password"
              autoComplete="off"
              placeholder="sbp_…"
              value={token}
              disabled={demo}
              aria-describedby="pat-token-hint"
              onChange={(e) => setToken(e.target.value)}
            />
            <span id="pat-token-hint" className="pb-field-hint">
              Create a token at{' '}
              <a href={TOKENS_URL} target="_blank" rel="noopener noreferrer">
                supabase.com/dashboard/account/tokens <Icon name="external" size={12} />
              </a>. We use it only to read your project list and table sizes. It is never saved.
            </span>
          </div>
          <button type="button" className="pb-btn pb-btn-primary" disabled={loading} onClick={showProjects}>
            {loading ? 'Loading…' : 'Show my projects'}
          </button>
        </div>
      )}

      {step === 'projects' && (
        <div className="pb-stack">
          <p className="pb-muted">
            Pick the database to back up.{' '}
            {oneDatabaseOnly ? <strong>The {plan.shortLabel || planId} plan allows one database.</strong> : null}
          </p>
          {!projects?.length ? (
            <div className="pb-empty">
              <Icon name="server" size={28} />
              <h3>No projects found</h3>
              <p>That token has no Supabase projects, or the projects are not visible to it.</p>
            </div>
          ) : (
            <div className="pb-grid pb-grid-2" role="radiogroup" aria-label="Supabase projects">
              {projects.map((p) => (
                <button
                  key={p.ref}
                  type="button"
                  role="radio"
                  aria-checked={selectedRef === p.ref}
                  className={`pb-card pb-choice${selectedRef === p.ref ? ' is-on' : ''}`}
                  onClick={() => setSelectedRef(p.ref)}
                >
                  <small>{p.region || 'region n/a'} · {p.status || 'unknown'}</small>
                  <b>{p.name || p.ref}</b>
                  <p className="pb-mono">{p.ref}</p>
                </button>
              ))}
            </div>
          )}
          <div className="pb-inline">
            <button type="button" className="pb-btn" onClick={() => setStep('connect')}>Back</button>
            <button
              type="button"
              className="pb-btn pb-btn-primary"
              disabled={loading || !selectedRef}
              onClick={measureIt}
            >
              {loading ? 'Measuring…' : 'Measure it'}
            </button>
          </div>
        </div>
      )}

      {step === 'select' && inventory && (
        <div className="pb-stack">
          <p className="pb-muted">
            Choose what goes in the capsule. Excluding a table keeps its structure but skips its rows.
            Excluding a bucket skips its files.
          </p>
          <TableSizer
            inventory={inventory}
            planId={planId}
            onPlanId={() => {}}
            selection={selection}
            onSelection={setSelection}
            excludeBinaries={excludeBinaries}
            onExcludeBinaries={setExcludeBinaries}
            demo={demo}
            compact
          />
          <div className="pb-inline">
            <button type="button" className="pb-btn" onClick={() => setStep('projects')}>Back</button>
            <button type="button" className="pb-btn pb-btn-primary" onClick={() => setStep('save')}>Continue</button>
          </div>
        </div>
      )}

      {step === 'save' && summary && (
        <div className="pb-stack">
          <div className={`pb-sizer-fit${overCap ? ' is-over' : ' is-ok'}`}>
            <div>
              <strong>{overCap ? 'Over plan cap — cannot save' : 'Ready to save'}</strong>
              <p>
                {selectedProject?.name || selectedRef} · {formatHumanSize(summary.includedBytes)} of {capLabel}
                {overCap ? ` · over by ${formatHumanSize(summary.includedBytes - capBytes)}` : ''}.
              </p>
            </div>
          </div>
          <div className="pb-card">
            <div className="pb-card-head">
              <h3>Equivalent CLI command</h3>
              <span>copy &amp; run yourself</span>
            </div>
            <p className="pb-mono pb-sizer-flag" style={{ wordBreak: 'break-word' }}>{cliCommand}</p>
            <button type="button" className="pb-btn pb-btn-sm" onClick={() => copyText(cliCommand, toast)}>
              <Icon name="copy" size={14} /> Copy command
            </button>
          </div>
          <div className="pb-inline">
            <button type="button" className="pb-btn" onClick={() => setStep('select')}>Back</button>
            <button type="button" className="pb-btn pb-btn-primary" disabled={loading || overCap} onClick={save}>
              {loading ? 'Saving…' : 'Save selection'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
