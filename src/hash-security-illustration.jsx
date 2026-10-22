import React from 'react';

/**
 * Visual illustration explaining the one-way hash barrier:
 * Why automated backup tools cannot read secrets back out, and why rotating to Notepad is the only chance to capture.
 */
export function HashSecurityIllustration() {
  return (
    <div style={{
      background: 'linear-gradient(180deg, #161b22 0%, #0d1117 100%)',
      border: '1px solid #30363d',
      borderRadius: '12px',
      padding: '24px 20px',
      margin: '20px 0 24px',
    }}>
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <span style={{ fontSize: '11px', color: '#58a6ff', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          HOW SUPABASE SECRET SECURITY WORKS
        </span>
        <h3 style={{ margin: '4px 0 6px', fontSize: '18px', color: '#f0f6fc', fontWeight: 700 }}>
          Why Automated Backups Cannot Extract Plaintext Secrets
        </h3>
        <p style={{ margin: 0, fontSize: '13px', color: '#8b949e', maxWidth: '680px', marginInline: 'auto' }}>
          Supabase treats secret values as write-only. Understanding this 3-step security barrier explains why keeping your own private record is essential.
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '16px',
        alignItems: 'stretch',
      }}>
        {/* Step 1: Input */}
        <div style={{
          background: '#0d1117',
          border: '1px solid #30363d',
          borderRadius: '8px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '24px', height: '24px', borderRadius: '50%',
              background: '#21262d', color: '#58a6ff', fontSize: '12px', fontWeight: 700,
            }}>1</span>
            <strong style={{ fontSize: '14px', color: '#f0f6fc' }}>You Enter a Secret</strong>
          </div>
          <div style={{
            background: '#161b22',
            border: '1px solid #21262d',
            borderRadius: '6px',
            padding: '10px 12px',
            fontFamily: 'monospace',
            fontSize: '12px',
            color: '#3ecf8e',
            marginBottom: '10px',
          }}>
            STRIPE_KEY = &quot;sk_live_9a...&quot;
          </div>
          <p style={{ fontSize: '12px', color: '#8b949e', margin: 0, lineHeight: 1.5, flex: 1 }}>
            When you enter an API key, database password, or OAuth secret into Supabase, you see the plaintext for only a single brief second.
          </p>
        </div>

        {/* Step 2: The Hash Barrier */}
        <div style={{
          background: '#0d1117',
          border: '1px solid #388bfd',
          borderRadius: '8px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 0 15px rgba(56, 139, 253, 0.1)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '24px', height: '24px', borderRadius: '50%',
              background: '#1f6feb', color: '#fff', fontSize: '12px', fontWeight: 700,
            }}>2</span>
            <strong style={{ fontSize: '14px', color: '#f0f6fc' }}>Stored as One-Way Hash</strong>
          </div>
          <div style={{
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: '6px',
            padding: '10px 12px',
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#8b949e',
            marginBottom: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span>#e3b0c44298fc1c...</span>
            <span style={{ color: '#f85149', fontWeight: 700, fontSize: '10px', background: 'rgba(248,81,73,0.15)', padding: '2px 6px', borderRadius: '4px' }}>
              READ BLOCKED
            </span>
          </div>
          <p style={{ fontSize: '12px', color: '#8b949e', margin: 0, lineHeight: 1.5, flex: 1 }}>
            Supabase scrambles the value into an irreversible fingerprint. It never saves plaintext. When your app runs, Supabase only checks: <strong style={{ color: '#f0f6fc' }}>True or False?</strong> No automated tool can extract what isn&apos;t there.
          </p>
        </div>

        {/* Step 3: Your Safe Record */}
        <div style={{
          background: '#0d1117',
          border: '1px solid #238636',
          borderRadius: '8px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 0 15px rgba(46, 160, 67, 0.1)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '24px', height: '24px', borderRadius: '50%',
              background: '#238636', color: '#fff', fontSize: '12px', fontWeight: 700,
            }}>3</span>
            <strong style={{ fontSize: '14px', color: '#f0f6fc' }}>Your 2-Minute Notepad Save</strong>
          </div>
          <div style={{
            background: '#0d281e',
            border: '1px solid #238636',
            borderRadius: '6px',
            padding: '10px 12px',
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#3ecf8e',
            marginBottom: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span>📝 Saved to MySecrets.txt</span>
            <span style={{ color: '#3ecf8e', fontWeight: 700 }}>✓ READY</span>
          </div>
          <p style={{ fontSize: '12px', color: '#8b949e', margin: 0, lineHeight: 1.5, flex: 1 }}>
            <strong style={{ color: '#3ecf8e' }}>The Golden Rule:</strong> The only chance you ever have to copy a secret is when you create or rotate it. By saving a copy now, you ensure 100% turnkey recovery on your lifeboat project.
          </p>
        </div>
      </div>
    </div>
  );
}
