import React, { useState } from 'react';

export function InMemoryTrustPanel() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div style={{ background: '#161b22', border: '1px solid #30363d', borderLeft: '4px solid #3ecf8e', borderRadius: '8px', padding: '16px 20px', marginTop: '16px', marginBottom: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(62, 207, 142, 0.12)', border: '1px solid rgba(62, 207, 142, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3ecf8e" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div>
            <h4 style={{ margin: 0, fontSize: '15px', color: '#f0f6fc', fontWeight: 600 }}>In-Memory Vault Isolation Guarantee</h4>
            <p style={{ margin: '3px 0 0', fontSize: '13px', color: '#8b949e' }}>
              Credentials exist strictly in ephemeral process memory. Zero vendor custody. Capsules encrypt locally before moving point-to-point.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="pb-btn pb-btn-sm"
          style={{ background: '#21262d', borderColor: '#30363d', color: '#58a6ff', display: 'flex', alignItems: 'center', gap: '6px' }}
          onClick={() => setModalOpen(true)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          How In-Memory Protection Works &amp; Verification Proof
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px', marginTop: '14px', paddingTop: '12px', borderTop: '1px solid #21262d' }}>
        <div style={{ fontSize: '12px', color: '#c9d1d9' }}>
          <strong style={{ color: '#f0f6fc', display: 'block', marginBottom: '2px' }}>🔒 Ephemeral RAM Only</strong>
          Tokens &amp; keys are held in volatile execution memory and purged when the backup completes. Never written to plain disk.
        </div>
        <div style={{ fontSize: '12px', color: '#c9d1d9' }}>
          <strong style={{ color: '#f0f6fc', display: 'block', marginBottom: '2px' }}>⚡ Direct Point-to-Point</strong>
          Data flows directly from your database to your chosen storage vault (Dropbox, S3, R2, Local). Portabase servers never proxy your bytes.
        </div>
        <div style={{ fontSize: '12px', color: '#c9d1d9' }}>
          <strong style={{ color: '#f0f6fc', display: 'block', marginBottom: '2px' }}>🛡️ Client-Sealed Encryption</strong>
          Encrypted with military-grade AES-256-GCM using your customer passphrase before leaving the memory sandbox.
        </div>
      </div>

      {/* Deep-Dive Verification Modal */}
      {modalOpen && (
        <div className="pb-modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="pb-modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
            <div className="pb-modal-head" style={{ borderBottom: '1px solid #30363d', paddingBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: '20px' }}>🛡️</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', color: '#f0f6fc' }}>In-Memory Security Architecture &amp; Verifiability</h3>
                  <small style={{ color: '#8b949e' }}>How Portabase guarantees your secrets never leak outside the client</small>
                </div>
              </div>
              <button type="button" className="pb-btn-icon" onClick={() => setModalOpen(false)}>✕</button>
            </div>

            <div className="pb-modal-body" style={{ maxHeight: '70vh', overflowY: 'auto', padding: '16px 0', fontSize: '13px', lineHeight: 1.6, color: '#c9d1d9' }}>
              <section style={{ marginBottom: 18 }}>
                <h4 style={{ color: '#3ecf8e', margin: '0 0 6px', fontSize: '14px' }}>1. How the In-Memory Execution Loop Operates</h4>
                <p style={{ margin: 0 }}>
                  When you initiate a backup or connect a vault provider, your authentication tokens and database passwords exist exclusively in
                  <strong> transient Node.js process memory</strong>. Once the backup capsule is assembled and encrypted, sensitive buffers are explicitly overwritten and unreferenced for immediate garbage collection. No plaintext credentials ever hit temporary swap files or debug log files.
                </p>
              </section>

              <section style={{ marginBottom: 18 }}>
                <h4 style={{ color: '#3ecf8e', margin: '0 0 6px', fontSize: '14px' }}>2. Point-to-Point Transport (Zero Vendor Man-in-the-Middle)</h4>
                <p style={{ margin: 0 }}>
                  Unlike traditional cloud backup SaaS services that route customer databases through centralized proxy clusters, Portabase establishes
                  <strong> direct, point-to-point TLS connections</strong> from the client environment directly to Supabase and directly to your storage vault (e.g. Dropbox API, Cloudflare R2 S3 endpoints, or your local drive). Portabase control plane servers receive only cryptographic completion hashes and status flags.
                </p>
              </section>

              <section style={{ marginBottom: 18 }}>
                <h4 style={{ color: '#3ecf8e', margin: '0 0 6px', fontSize: '14px' }}>3. How You Can Verify This Independently</h4>
                <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', padding: '12px', marginTop: 6 }}>
                  <strong style={{ color: '#f0f6fc' }}>DevTools Network Inspection Test:</strong>
                  <ol style={{ margin: '6px 0 0', paddingLeft: '18px', color: '#8b949e' }}>
                    <li>Open your browser's Developer Tools (<kbd>F12</kbd> or <kbd>Ctrl+Shift+I</kbd>).</li>
                    <li>Click on the <strong>Network</strong> tab and filter by <strong>Fetch/XHR</strong>.</li>
                    <li>Connect a provider or trigger a test connection.</li>
                    <li>Inspect every outgoing payload: you will observe that no passwords, access keys, or secret tokens are ever sent to <code>portabase.dev</code>.</li>
                  </ol>
                </div>
              </section>

              <section style={{ marginBottom: 18 }}>
                <h4 style={{ color: '#3ecf8e', margin: '0 0 6px', fontSize: '14px' }}>4. Content Security Policy (CSP) &amp; Socket Enclosures</h4>
                <p style={{ margin: 0 }}>
                  In the client runner environment, HTTP responses enforce a strict Content Security Policy:
                  <code style={{ display: 'block', background: '#0d1117', padding: '6px 8px', borderRadius: '4px', margin: '6px 0', color: '#79c0ff', fontSize: '11px', fontFamily: 'monospace' }}>
                    Content-Security-Policy: default-src 'self'; connect-src 'self'; frame-ancestors 'none';
                  </code>
                  This prevents the client application from establishing unauthorized outbound HTTP or WebSocket connections to third-party endpoints.
                </p>
              </section>

              <section>
                <h4 style={{ color: '#3ecf8e', margin: '0 0 6px', fontSize: '14px' }}>5. Open-Source Cryptographic Pipeline</h4>
                <p style={{ margin: 0 }}>
                  Capsule encryption uses scrypt key derivation (32-byte key, <code>N=32768</code>, <code>r=8</code>, <code>p=1</code>) and authenticated
                  <strong> AES-256-GCM</strong>. The cipher implementation is 100% open-source and inspectable in:
                  <br />
                  <a href="https://github.com/data-automation-ai/portabase.dev/blob/main/utility/capsule-crypto.mjs" target="_blank" rel="noreferrer" style={{ color: '#58a6ff', textDecoration: 'underline', fontFamily: 'monospace', fontSize: '12px' }}>
                    utility/capsule-crypto.mjs (GitHub)
                  </a>
                </p>
              </section>
            </div>

            <div className="pb-modal-foot" style={{ borderTop: '1px solid #30363d', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <a href="/security" target="_blank" rel="noreferrer" style={{ color: '#58a6ff', fontSize: '12px', display: 'flex', alignItems: 'center', gap: 4 }}>
                Read Complete Zero-Knowledge Whitepaper ↗
              </a>
              <button type="button" className="pb-btn pb-btn-sm pb-btn-primary" onClick={() => setModalOpen(false)}>
                Understood &amp; Verified
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
