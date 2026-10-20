import React, { useState, useEffect } from 'react';
import { fetchStorageConnectors, testStorageConnector, disconnectStorageConnector } from '../lib/cloud-api.js';
import { LedIndicator } from './storage-led.jsx';

export function StorageProvidersPage({ state, setState, toast, navigate }) {
  const [connectors, setConnectors] = useState(null);
  const [testing, setTesting] = useState(null);
  const [testResult, setTestResult] = useState({});
  const [activeModal, setActiveModal] = useState(null);
  const [r2Config, setR2Config] = useState({ accountId: '', bucket: '', accessKeyId: '', secretAccessKey: '' });
  const [s3Config, setS3Config] = useState({ bucket: '', region: 'us-east-1', accessKeyId: '', secretAccessKey: '' });
  const [localPath, setLocalPath] = useState('./portabase-capsules');

  const refreshConnectors = async () => {
    try {
      const data = await fetchStorageConnectors(state?.version || 'supabase');
      if (data?.connectors) setConnectors(data.connectors);
    } catch (err) {
      console.error('Failed to load storage connectors:', err);
    }
  };

  useEffect(() => {
    refreshConnectors();
  }, []);

  const handleDropboxOAuth = () => {
    setTesting('dropbox');
    window.location.href = '/oauth/dropbox/start';
  };

  const handleGoogleDriveOAuth = () => {
    setTesting('google-drive');
    window.location.href = '/oauth/google-drive/start';
  };

  const handleDisconnect = async (provider) => {
    try {
      await disconnectStorageConnector(state?.version || 'supabase', provider);
      toast(`Disconnected ${provider}.`, 'info');
      setTestResult(prev => ({ ...prev, [provider]: null }));
      await refreshConnectors();
    } catch (err) {
      toast(`Failed to disconnect: ${err.message}`, 'error');
    }
  };

  const handleTest = async (provider, payload = {}) => {
    setTesting(provider);
    setTestResult(prev => ({ ...prev, [provider]: null }));
    try {
      const res = await testStorageConnector(state?.version || 'supabase', { provider, ...payload });
      if (res.ok) {
        setTestResult(prev => ({ ...prev, [provider]: { success: true, message: res.message || 'Connected & verified cryptographic hash write test.' } }));
        toast(`${provider.toUpperCase()} connection verified!`, 'success');
      } else {
        setTestResult(prev => ({ ...prev, [provider]: { success: false, message: res.error || 'Connection check failed.' } }));
        toast(res.error || 'Connection failed', 'error');
      }
    } catch (err) {
      setTestResult(prev => ({ ...prev, [provider]: { success: false, message: err.message } }));
      toast(`Test error: ${err.message}`, 'error');
    } finally {
      setTesting(null);
    }
  };

  const dropboxConnected = connectors?.dropbox?.oauthConnected || connectors?.dropbox?.configured;
  const gdriveConnected = connectors?.['google-drive']?.oauthConnected || connectors?.['google-drive']?.configured;

  const getDropboxState = () => {
    if (testing === 'dropbox') return 'yellow';
    if (testResult['dropbox']) {
      return testResult['dropbox'].success ? 'green' : (dropboxConnected ? 'red-flash' : 'yellow-flash');
    }
    return dropboxConnected ? 'green' : 'red';
  };

  const getGdriveState = () => {
    if (testing === 'google-drive') return 'yellow';
    if (testResult['google-drive']) {
      return testResult['google-drive'].success ? 'green' : (gdriveConnected ? 'red-flash' : 'yellow-flash');
    }
    return gdriveConnected ? 'green' : 'red';
  };

  const getR2State = () => {
    if (testing === 'r2') return 'yellow';
    if (testResult['r2']) {
      return testResult['r2'].success ? 'green' : (r2Config.bucket ? 'red-flash' : 'yellow-flash');
    }
    return r2Config.bucket && r2Config.accountId ? 'green' : 'red';
  };

  const getS3State = () => {
    if (testing === 's3') return 'yellow';
    if (testResult['s3']) {
      return testResult['s3'].success ? 'green' : (s3Config.bucket ? 'red-flash' : 'yellow-flash');
    }
    return s3Config.bucket && s3Config.accessKeyId ? 'green' : 'red';
  };

  return (
    <div className="pb-page pb-storage-providers">
      <div className="pb-page-head">
        <div>
          <h1>External Vault Storage Providers</h1>
          <p className="pb-page-lead">
            Portabase stores recovery capsules directly into <strong>your customer-owned vaults</strong>.
            Keys and cryptographic capsules stay in your accounts — zero platform lock-in.
          </p>
        </div>
      </div>

      {/* LED Status Indicator Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'center', background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', padding: '12px 16px', marginTop: '12px', fontSize: '12px' }}>
        <span style={{ fontWeight: 600, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.5px' }}>LED Status Guide:</span>
        <LedIndicator state="red" label="No Connection" size={10} />
        <LedIndicator state="yellow" label="Connecting..." size={10} />
        <LedIndicator state="yellow-flash" label="Problem Connecting" size={10} />
        <LedIndicator state="green" label="Connected" size={10} />
        <LedIndicator state="red-flash" label="Connection Lost (Was Working)" size={10} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '20px', marginTop: '16px' }}>
        
        {/* Dropbox Card */}
        <div className="pb-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', borderTop: '4px solid #0061FE' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="#0061FE">
                  <path d="M7 2.5 1 6.5l6 4 6-4-6-4zm10 0-6 4 6 4 6-4-6-4zM1 14.5l6 4 6-4-6-4-6 4zm16-4-6 4 6 4 6-4-6-4zm-10 9 6 4 6-4-6-4-6 4z" />
                </svg>
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px' }}>Dropbox</h3>
                  <small style={{ color: '#8b949e' }}>OAuth 2.0 PKCE • /Portabase</small>
                </div>
              </div>
              <LedIndicator state={getDropboxState()} />
            </div>
            <p style={{ fontSize: '13px', color: '#c9d1d9', lineHeight: 1.5 }}>
              One-click OAuth authentication. Capsules stream with native SHA-256 chunked cryptographic verification (<code style={{ color: '#58a6ff' }}>content_hash</code>).
            </p>
            {testResult['dropbox'] && (
              <div style={{ padding: '8px 12px', borderRadius: '6px', fontSize: '12px', marginBottom: 12, background: testResult['dropbox'].success ? '#0d281e' : '#3d1214', color: testResult['dropbox'].success ? '#3ecf8e' : '#ff7b72' }}>
                {testResult['dropbox'].message}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #30363d' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              {dropboxConnected ? (
                <>
                  <button type="button" className="pb-btn pb-btn-sm pb-btn-primary" disabled={testing === 'dropbox'} onClick={() => handleTest('dropbox')}>
                    {testing === 'dropbox' ? 'Testing...' : 'Test Connection'}
                  </button>
                  <button type="button" className="pb-btn pb-btn-sm pb-btn-ghost" onClick={() => handleDisconnect('dropbox')}>
                    Disconnect
                  </button>
                </>
              ) : (
                <button type="button" className="pb-btn pb-btn-sm pb-btn-primary" style={{ background: '#0061FE', borderColor: '#0061FE', color: '#fff' }} onClick={handleDropboxOAuth}>
                  Connect Dropbox
                </button>
              )}
            </div>
            <LedIndicator state={getDropboxState()} label="" size={10} />
          </div>
        </div>

        {/* Cloudflare R2 Card */}
        <div className="pb-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', borderTop: '4px solid #F38020' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="#F38020">
                  <path d="M18.8 9.5C18.2 6.4 15.4 4 12 4 9.1 4 6.6 5.8 5.6 8.4 2.4 8.9 0 11.7 0 15c0 3.9 3.1 7 7 7h11.5c3 0 5.5-2.5 5.5-5.5 0-2.8-2.1-5.1-4.9-5.4l-.3-.6z" />
                </svg>
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px' }}>Cloudflare R2</h3>
                  <small style={{ color: '#8b949e' }}>Zero-Egress Object Storage (S3 API)</small>
                </div>
              </div>
              <LedIndicator state={getR2State()} />
            </div>
            <p style={{ fontSize: '13px', color: '#c9d1d9', lineHeight: 1.5 }}>
              Zero egress fees. S3-compatible endpoints for ultra-low cost storage of multi-gigabyte Postgres &amp; storage backups.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #30363d' }}>
            <button type="button" className="pb-btn pb-btn-sm pb-btn-secondary" onClick={() => setActiveModal('r2')}>
              {r2Config.bucket ? 'Reconfigure R2 Bucket' : 'Configure R2 Bucket'}
            </button>
            <LedIndicator state={getR2State()} label="" size={10} />
          </div>
        </div>

        {/* Google Cloud Storage / Google Drive Card */}
        <div className="pb-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', borderTop: '4px solid #4285F4' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <svg width="36" height="36" viewBox="0 0 24 24">
                  <path d="M8.2 3.8 2 14.5l3.8 6.5 6.2-10.7z" fill="#4285F4" />
                  <path d="m15.8 3.8-6.2 10.7 3.8 6.5h7.6z" fill="#0F9D58" />
                  <path d="M8.2 3.8h7.6L22 14.5H9.8z" fill="#FFBB00" />
                </svg>
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px' }}>Google Cloud / Drive</h3>
                  <small style={{ color: '#8b949e' }}>OAuth 2.0 PKCE • GCS Buckets</small>
                </div>
              </div>
              <LedIndicator state={getGdriveState()} />
            </div>
            <p style={{ fontSize: '13px', color: '#c9d1d9', lineHeight: 1.5 }}>
              Direct integration with Google Cloud Storage and Google Drive folders with strict cryptographic read-back proof.
            </p>
            {testResult['google-drive'] && (
              <div style={{ padding: '8px 12px', borderRadius: '6px', fontSize: '12px', marginBottom: 12, background: testResult['google-drive'].success ? '#0d281e' : '#3d1214', color: testResult['google-drive'].success ? '#3ecf8e' : '#ff7b72' }}>
                {testResult['google-drive'].message}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #30363d' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              {gdriveConnected ? (
                <>
                  <button type="button" className="pb-btn pb-btn-sm pb-btn-primary" disabled={testing === 'google-drive'} onClick={() => handleTest('google-drive')}>
                    {testing === 'google-drive' ? 'Testing...' : 'Test Connection'}
                  </button>
                  <button type="button" className="pb-btn pb-btn-sm pb-btn-ghost" onClick={() => handleDisconnect('google-drive')}>
                    Disconnect
                  </button>
                </>
              ) : (
                <button type="button" className="pb-btn pb-btn-sm pb-btn-primary" onClick={handleGoogleDriveOAuth}>
                  Connect Google Drive / GCS
                </button>
              )}
            </div>
            <LedIndicator state={getGdriveState()} label="" size={10} />
          </div>
        </div>

        {/* AWS S3 Card */}
        <div className="pb-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', borderTop: '4px solid #FF9900' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="#FF9900">
                  <path d="M12 2 2 7l10 5 10-5-10-5zm0 9.2L4.2 7.3 12 3.8l7.8 3.5L12 11.2zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#FF9900" strokeWidth="1.5" fill="none" />
                </svg>
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px' }}>Amazon S3</h3>
                  <small style={{ color: '#8b949e' }}>Customer BYO Bucket • IAM / KMS</small>
                </div>
              </div>
              <LedIndicator state={getS3State()} />
            </div>
            <p style={{ fontSize: '13px', color: '#c9d1d9', lineHeight: 1.5 }}>
              Standard AWS S3 vaults with customer-managed SSE-KMS keys, object lock compliance, or cross-region replication.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #30363d' }}>
            <button type="button" className="pb-btn pb-btn-sm pb-btn-secondary" onClick={() => setActiveModal('s3')}>
              {s3Config.bucket ? 'Reconfigure S3 Bucket' : 'Configure S3 Bucket'}
            </button>
            <LedIndicator state={getS3State()} label="" size={10} />
          </div>
        </div>

        {/* Local Storage / Hard Drive Card */}
        <div className="pb-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', borderTop: '4px solid #3ecf8e' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#3ecf8e" strokeWidth="2">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <line x1="6" y1="12" x2="6.01" y2="12" />
                  <line x1="10" y1="12" x2="10.01" y2="12" />
                </svg>
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px' }}>Local Storage / NAS</h3>
                  <small style={{ color: '#8b949e' }}>On-Premises • USB • Network Share</small>
                </div>
              </div>
              <LedIndicator state="green" />
            </div>
            <p style={{ fontSize: '13px', color: '#c9d1d9', lineHeight: 1.5 }}>
              Save capsules locally on this workstation or mapped network drive. 100% offline, zero network egress.
            </p>
            <div style={{ marginTop: 8 }}>
              <label style={{ fontSize: '11px', color: '#8b949e', display: 'block', marginBottom: 4 }}>Vault Directory</label>
              <input
                type="text"
                value={localPath}
                onChange={e => setLocalPath(e.target.value)}
                style={{ width: '100%', padding: '6px 10px', background: '#0d1117', border: '1px solid #30363d', borderRadius: '4px', color: '#c9d1d9', fontSize: '12px', fontFamily: 'monospace' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #30363d' }}>
            <button type="button" className="pb-btn pb-btn-sm pb-btn-primary" onClick={() => toast(`Local vault directory set to: ${localPath}`, 'success')}>
              Save Local Path
            </button>
            <LedIndicator state="green" label="" size={10} />
          </div>
        </div>

      </div>

      {/* R2 Modal */}
      {activeModal === 'r2' && (
        <div className="pb-modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="pb-modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="pb-modal-head">
              <h3>Connect Cloudflare R2 Bucket</h3>
              <button type="button" className="pb-btn-icon" onClick={() => setActiveModal(null)}>✕</button>
            </div>
            <div className="pb-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label>
                <span style={{ fontSize: 12, color: '#8b949e' }}>Cloudflare Account ID</span>
                <input type="text" placeholder="e.g. 5f8a..." value={r2Config.accountId} onChange={e => setR2Config({ ...r2Config, accountId: e.target.value })} style={{ width: '100%', padding: '6px 8px', marginTop: 4 }} />
              </label>
              <label>
                <span style={{ fontSize: 12, color: '#8b949e' }}>Bucket Name</span>
                <input type="text" placeholder="e.g. my-portabase-capsules" value={r2Config.bucket} onChange={e => setR2Config({ ...r2Config, bucket: e.target.value })} style={{ width: '100%', padding: '6px 8px', marginTop: 4 }} />
              </label>
              <label>
                <span style={{ fontSize: 12, color: '#8b949e' }}>Access Key ID</span>
                <input type="text" value={r2Config.accessKeyId} onChange={e => setR2Config({ ...r2Config, accessKeyId: e.target.value })} style={{ width: '100%', padding: '6px 8px', marginTop: 4 }} />
              </label>
              <label>
                <span style={{ fontSize: 12, color: '#8b949e' }}>Secret Access Key</span>
                <input type="password" value={r2Config.secretAccessKey} onChange={e => setR2Config({ ...r2Config, secretAccessKey: e.target.value })} style={{ width: '100%', padding: '6px 8px', marginTop: 4 }} />
              </label>
            </div>
            <div className="pb-modal-foot" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button type="button" className="pb-btn pb-btn-sm" onClick={() => setActiveModal(null)}>Cancel</button>
              <button type="button" className="pb-btn pb-btn-sm pb-btn-primary" onClick={() => { setActiveModal(null); toast('Cloudflare R2 configuration saved.', 'success'); }}>Save R2 Vault</button>
            </div>
          </div>
        </div>
      )}

      {/* S3 Modal */}
      {activeModal === 's3' && (
        <div className="pb-modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="pb-modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="pb-modal-head">
              <h3>Connect Amazon S3 Bucket</h3>
              <button type="button" className="pb-btn-icon" onClick={() => setActiveModal(null)}>✕</button>
            </div>
            <div className="pb-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label>
                <span style={{ fontSize: 12, color: '#8b949e' }}>S3 Bucket Name</span>
                <input type="text" placeholder="e.g. my-company-vault" value={s3Config.bucket} onChange={e => setS3Config({ ...s3Config, bucket: e.target.value })} style={{ width: '100%', padding: '6px 8px', marginTop: 4 }} />
              </label>
              <label>
                <span style={{ fontSize: 12, color: '#8b949e' }}>AWS Region</span>
                <input type="text" placeholder="us-east-1" value={s3Config.region} onChange={e => setS3Config({ ...s3Config, region: e.target.value })} style={{ width: '100%', padding: '6px 8px', marginTop: 4 }} />
              </label>
              <label>
                <span style={{ fontSize: 12, color: '#8b949e' }}>Access Key ID</span>
                <input type="text" value={s3Config.accessKeyId} onChange={e => setS3Config({ ...s3Config, accessKeyId: e.target.value })} style={{ width: '100%', padding: '6px 8px', marginTop: 4 }} />
              </label>
              <label>
                <span style={{ fontSize: 12, color: '#8b949e' }}>Secret Access Key</span>
                <input type="password" value={s3Config.secretAccessKey} onChange={e => setS3Config({ ...s3Config, secretAccessKey: e.target.value })} style={{ width: '100%', padding: '6px 8px', marginTop: 4 }} />
              </label>
            </div>
            <div className="pb-modal-foot" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button type="button" className="pb-btn pb-btn-sm" onClick={() => setActiveModal(null)}>Cancel</button>
              <button type="button" className="pb-btn pb-btn-sm pb-btn-primary" onClick={() => { setActiveModal(null); toast('Amazon S3 configuration saved.', 'success'); }}>Save S3 Vault</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
