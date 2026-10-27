# Confidential recovery validation

This is an isolated, incomplete implementation of Portabase recovery on Google
Confidential Space with Intel TDX. It is not the released hosted customer flow.
See [the current checkpoint](DRY-RUN-STATUS.md) and the repository's
[capability ledger](../../PROJECT_STATUS.md).

`client.mjs` verifies Google-signed attestation against a pinned image, project,
hardware policy, fresh challenge and workload key before encrypting commands.
The controller forwards encrypted workload commands. The workload handles
Supabase OAuth, temporary database credentials, capture and guarded restore.
`cloud-confidential-admission.mjs` enforces authenticated persistent admission.

An independently obtained verifier and independently approved image policy are
still required for an operator-resistant customer trust model. JavaScript
served solely by Portabase cannot establish that independence. Data executes
inside a protected VM in Portabase's Google project; it does traverse our
infrastructure. It is incorrect to describe this as never touching our servers.

Build through `prepare-application.ps1` from a clean, verified checkout. Its
explicit source allowlist excludes operator tooling and local evidence from
runtime images. Do not build the application Dockerfile from an unfiltered
working directory containing operator files or private artifacts.

The operator helper uses only the named synthetic fixtures. Its recovery key is
derived from the synthetic account password and is not a customer custody
policy. Sealed OAuth profiles are stored encrypted; raw tokens, callback codes,
keys and provider responses must not be printed or committed. All capture
staging stays on the cloud runner. Never use drive F:.

Run individual focused tests, for example:

```powershell
node --test cloud/confidential/attestation.test.mjs
node --test cloud/confidential/client.test.mjs
node --test tests/confidential-admission.test.mjs
```

Operator evidence is ignored by Git. Local tests and an attested session do not
prove an end-to-end customer backup, external vault delivery or application
recovery. Those gates remain open.
