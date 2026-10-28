import React from 'react';
import './attestation-evidence.css';

const certificate='/evidence/portabase-live-attestation.png';
export default function AttestationEvidence(){
  return <section className="section attestation-evidence" aria-labelledby="attestation-evidence-title">
    <div className="shell attestation-evidence-grid">
      <div>
        <div className="section-kicker">Inside the recovery runner</div>
        <h2 id="attestation-evidence-title">Hardware protection.<br/>Evidence you can inspect.</h2>
        <p>PortaBase processes recovery data inside a hardware-protected enclave. Before sending credentials, its verifier checks the runner’s Google-signed attestation, software image, and encryption-key binding.</p>
        <p>This is the original certificate screenshot from a live Intel TDX runner. Public project identifiers and image hashes remain visible so the details can be inspected.</p>
        <a href={certificate} target="_blank" rel="noreferrer">View the full certificate ↗</a>
        <p className="attestation-evidence-note">A record of runner attestation—not an independent audit or proof that a full recovery succeeded. The managed workload handles plaintext inside the enclave.</p>
      </div>
      <figure>
        <a href={certificate} target="_blank" rel="noreferrer" aria-label="Enlarge the original PortaBase attestation certificate">
          <img src={certificate} width="662" height="1284" loading="lazy" alt="Original PortaBase runner attestation certificate showing the container image hash, Intel TDX environment, public key fingerprint, and source and destination project identifiers."/>
        </a>
        <figcaption>Attestation certificate from a live PortaBase runner. Click to enlarge.</figcaption>
      </figure>
    </div>
  </section>;
}
