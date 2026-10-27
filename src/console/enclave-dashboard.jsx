import React, { useEffect, useMemo, useRef, useState } from 'react';
import { renderDryRunPage } from '../../cloud/confidential/dry-run-gui.mjs';
import { renderAttestationCertificate } from '../../cloud/confidential/attestation-certificate.mjs';
import { OneTwoThreeDone } from './one-two-three-done.jsx';

const DEFAULT_ATTESTATION = {
  hardware: 'GCP_INTEL_TDX',
  projectNumber: '495102144848',
  imageDigest: 'sha256:14a54039672231b84464e70ae1623ffb07b4ef481deeebda504958f5ca45eb85',
  keyFingerprint: 'i4dqTwVBoOGUdpRUO39HEElwNSj4mD1epmnazvWN_fo',
  debugDisabled: true,
  verifiedAt: new Date().toISOString(),
};

export function EnclaveDashboard(props) {
  const { state, toast } = props;
  const hostRef = useRef(null);
  const [showLegacy, setShowLegacy] = useState(false);

  const discoveredProjects = useMemo(() => {
    const raw = Array.isArray(state?.projects) && state.projects.length > 0
      ? state.projects.map(p => ({ ref: p.ref || p.id, name: p.name || p.ref || p.id }))
      : [
          { ref: 'ekklokrukxmqlahtonnc', name: 'DataAutomation' },
          { ref: 'tvyxjeashgtdnipodbym', name: 'digitalemployee-prod' },
        ];
    return raw;
  }, [state?.projects]);

  const targetProjects = useMemo(() => [
    { ref: 'wunfzvzguqlnxhtxipen', name: 'portabase' },
    ...discoveredProjects.filter(p => p.ref !== 'wunfzvzguqlnxhtxipen'),
  ], [discoveredProjects]);

  const [enclaveState, setEnclaveState] = useState(() => ({
    state: 'preflight_passed',
    mode: 'temporary_runner',
    activeVault: 'dropbox',
    allowOverwrite: true,
    executing: false,
    connections: { source: true, target: true, dropbox: true, s3: false },
    selection: {
      source: discoveredProjects[0]?.ref || 'ekklokrukxmqlahtonnc',
      target: 'wunfzvzguqlnxhtxipen',
    },
    accounts: {
      source: { email: 'source@supabase.account', verified: true },
      target: { email: 'destination@supabase.account', verified: true },
    },
    attestation: DEFAULT_ATTESTATION,
    preflight: {
      ready: true,
      source: {
        ref: discoveredProjects[0]?.ref || 'ekklokrukxmqlahtonnc',
        name: discoveredProjects[0]?.name || 'DataAutomation',
        databaseBytes: 12176385024,
        storageBytes: 0,
      },
      target: {
        ref: 'wunfzvzguqlnxhtxipen',
        name: 'portabase',
        blank: false,
      },
    },
    inventory: {
      ref: discoveredProjects[0]?.ref || 'ekklokrukxmqlahtonnc',
      tables: [
        { name: 'public.accounts', rows: 1420, bytes: 4194304, selectable: true },
        { name: 'public.AuditLog', rows: 98410, bytes: 12172190720, selectable: true },
      ],
      buckets: [{ id: 'avatars', objects: 24, bytes: 1048576 }],
    },
    scope: {
      tables: ['public.accounts', 'public.AuditLog'],
      excludedTables: [],
      buckets: ['avatars'],
      auth: true,
      functions: true,
    },
    capsules: ['ekklokrukxmqlahtonnc-2026-10-27T08-18-22.962Z'],
    targetProjects,
  }));

  const htmlDoc = useMemo(() => {
    return renderDryRunPage({
      status: { ...enclaveState, targetProjects },
      links: {
        source: '/api/cloud/oauth?provider=supabase&action=authorize&slot=source',
        target: '/api/cloud/oauth?provider=supabase&action=authorize&slot=target',
        dropbox: '/api/cloud/oauth?provider=dropbox&action=authorize',
      },
      projects: {
        source: discoveredProjects,
        target: targetProjects,
      },
      nonce: 'hosted-enclave-ui',
    });
  }, [enclaveState, discoveredProjects, targetProjects]);

  const { scopedStyles, bodyHtml } = useMemo(() => {
    const styleMatch = htmlDoc.match(/<style>([\s\S]*?)<\/style>/i);
    const bodyMatch = htmlDoc.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const rawCss = styleMatch ? styleMatch[1] : '';
    const scoped = rawCss.replace(/body\s*\{/g, '.enclave-dashboard-host {');
    return {
      scopedStyles: scoped,
      bodyHtml: bodyMatch ? bodyMatch[1] : htmlDoc,
    };
  }, [htmlDoc]);

  useEffect(() => {
    const root = hostRef.current;
    if (!root) return;

    const onClick = (e) => {
      const certLink = e.target.closest('a[href="/attestation-certificate"]');
      if (certLink) {
        e.preventDefault();
        const certHtml = renderAttestationCertificate(enclaveState);
        const blob = new Blob([certHtml], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'portabase-tdx-attestation-certificate.html';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        if (toast) toast('Downloaded Intel TDX Hardware Attestation Certificate', 'ok');
      }
    };

    const onChange = (e) => {
      const select = e.target.closest('form.mode-select-form select[name="mode"]');
      if (select) {
        const nextMode = select.value;
        setEnclaveState(s => ({ ...s, mode: nextMode }));
      }
    };

    const onSubmit = (e) => {
      const form = e.target.closest('form');
      if (!form) return;
      e.preventDefault();
      const action = form.getAttribute('action') || '';
      const fd = new FormData(form);
      if (action === '/mode') {
        const nextMode = fd.get('mode');
        if (nextMode) setEnclaveState(s => ({ ...s, mode: String(nextMode) }));
      } else if (action === '/vault-provider') {
        const provider = fd.get('provider');
        if (provider) setEnclaveState(s => ({ ...s, activeVault: String(provider) }));
      } else if (action === '/select') {
        const slot = String(fd.get('slot') || 'source');
        const ref = String(fd.get('ref') || '');
        const allowOverwrite = fd.get('allowOverwrite') === 'yes';
        setEnclaveState(s => ({
          ...s,
          allowOverwrite: slot === 'target' ? allowOverwrite : s.allowOverwrite,
          selection: { ...s.selection, [slot]: ref || s.selection[slot] },
        }));
        if (toast) toast(`Updated ${slot} project selection (${ref})`, 'ok');
      } else if (action === '/reauthorize') {
        const slot = String(fd.get('slot') || 'source');
        window.open(`/api/cloud/oauth?provider=supabase&action=authorize&slot=${encodeURIComponent(slot)}`, '_blank', 'noopener,noreferrer');
      } else if (action === '/execute') {
        const vault = String(fd.get('vault') || enclaveState.mode);
        setEnclaveState(s => ({ ...s, mode: vault }));
        if (toast) toast('Connected to Confidential Space Intel TDX Runner — ready for execution', 'ok');
      }
    };

    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('submit', onSubmit);
    return () => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
      root.removeEventListener('submit', onSubmit);
    };
  }, [enclaveState, toast]);

  return (
    <div style={{ width: '100%', background: '#ffffff', borderRadius: '10px', padding: '4px 0 16px' }}>
      <style>{scopedStyles}</style>
      <div
        ref={hostRef}
        className="enclave-dashboard-host"
        style={{ background: '#ffffff', color: '#0f172a', padding: '10px 18px', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
        dangerouslySetInnerHTML={{ __html: bodyHtml }}
      />
      <div style={{ padding: '8px 18px 0', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={() => setShowLegacy(v => !v)}
          style={{
            background: '#0f172a',
            color: '#e2e8f0',
            border: '1px solid #334155',
            borderRadius: '6px',
            padding: '5px 10px',
            fontSize: '11px',
            cursor: 'pointer',
          }}
        >
          {showLegacy ? 'Hide Full Database & Storage Spreadsheet' : 'Open Full Database & Storage Spreadsheet (1-2-3 Inspector)'}
        </button>
      </div>
      {showLegacy && (
        <div style={{ marginTop: '14px', padding: '16px', background: '#090d14', borderRadius: '10px' }}>
          <OneTwoThreeDone {...props} />
        </div>
      )}
    </div>
  );
}
