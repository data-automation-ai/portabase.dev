/**
 * Portabase Cloud console data layer.
 * Persists workspace state in localStorage; seeds professional demo data.
 * Never stores passphrases, service keys, or capsule bytes.
 */

const KEY = 'portabase.console.v1';

function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function hoursAgo(h) {
  return new Date(Date.now() - h * 3600e3).toISOString();
}

function daysAgo(d) {
  return hoursAgo(d * 24);
}

export function seedWorkspace(user = {}) {
  const projectA = uid('proj');
  const projectB = uid('proj');
  const agentA = uid('agent');
  const agentB = uid('agent');
  const destA = uid('dest');
  const destB = uid('dest');
  const policyA = uid('pol');

  const capsules = [
    { id: uid('cap'), projectId: projectA, projectRef: 'kiuwcdpjsdotkoojbkoi', status: 'COMPLETE', verified: true, destinationId: destA, destinationKind: 's3', sizeBytes: 482_331_904, durationMs: 184_200, createdAt: hoursAgo(2.1), edition: 'community', layers: { database: true, auth: true, storage: true, functions: true }, rpoHours: 2.1 },
    { id: uid('cap'), projectId: projectA, projectRef: 'kiuwcdpjsdotkoojbkoi', status: 'COMPLETE', verified: true, destinationId: destA, destinationKind: 's3', sizeBytes: 479_102_208, durationMs: 176_800, createdAt: hoursAgo(14), edition: 'community', layers: { database: true, auth: true, storage: true, functions: true }, rpoHours: 14 },
    { id: uid('cap'), projectId: projectA, projectRef: 'kiuwcdpjsdotkoojbkoi', status: 'COMPLETE', verified: true, destinationId: destB, destinationKind: 'dropbox', sizeBytes: 476_890_112, durationMs: 201_400, createdAt: hoursAgo(38), edition: 'community', layers: { database: true, auth: true, storage: true, functions: true }, rpoHours: 38 },
    { id: uid('cap'), projectId: projectB, projectRef: 'acmeprodxyzabcdefghij', status: 'COMPLETE', verified: true, destinationId: destA, destinationKind: 's3', sizeBytes: 91_204_608, durationMs: 42_100, createdAt: hoursAgo(5), edition: 'community', layers: { database: true, auth: true, storage: true, functions: false }, rpoHours: 5 },
    { id: uid('cap'), projectId: projectB, projectRef: 'acmeprodxyzabcdefghij', status: 'FAILED', verified: false, destinationId: destA, destinationKind: 's3', sizeBytes: 0, durationMs: 8_200, createdAt: hoursAgo(29), edition: 'community', layers: { database: false, auth: false, storage: false, functions: false }, rpoHours: null, errorClass: 'destination_unreachable' },
    { id: uid('cap'), projectId: projectA, projectRef: 'kiuwcdpjsdotkoojbkoi', status: 'COMPLETE', verified: false, destinationId: destB, destinationKind: 'dropbox', sizeBytes: 470_000_000, durationMs: 190_000, createdAt: daysAgo(4), edition: 'community', layers: { database: true, auth: true, storage: true, functions: true }, rpoHours: 96, errorClass: 'verify_checksum_mismatch' },
  ];

  const events = [
    { id: uid('evt'), type: 'backup.completed', projectRef: 'kiuwcdpjsdotkoojbkoi', agentId: agentA, occurredAt: hoursAgo(2.1), summary: 'Capsule verified · S3', level: 'ok' },
    { id: uid('evt'), type: 'agent.heartbeat', projectRef: 'kiuwcdpjsdotkoojbkoi', agentId: agentA, occurredAt: hoursAgo(0.4), summary: 'Heartbeat · RPO 2.1h', level: 'info' },
    { id: uid('evt'), type: 'backup.failed', projectRef: 'acmeprodxyzabcdefghij', agentId: agentB, occurredAt: hoursAgo(29), summary: 'destination_unreachable', level: 'error' },
    { id: uid('evt'), type: 'schedule.missed', projectRef: 'acmeprodxyzabcdefghij', agentId: agentB, occurredAt: hoursAgo(28.5), summary: 'Expected every 12h · 29h since success', level: 'warn' },
    { id: uid('evt'), type: 'verify.failed', projectRef: 'kiuwcdpjsdotkoojbkoi', agentId: agentA, occurredAt: daysAgo(4), summary: 'Remote checksum mismatch', level: 'error' },
    { id: uid('evt'), type: 'restore.completed', projectRef: 'kiuwcdpjsdotkoojbkoi', agentId: agentA, occurredAt: daysAgo(7), summary: 'Drill restore · evidence PARTIAL_OK', level: 'ok' },
    { id: uid('evt'), type: 'backup.completed', projectRef: 'acmeprodxyzabcdefghij', agentId: agentB, occurredAt: hoursAgo(5), summary: 'Capsule verified · S3', level: 'ok' },
    { id: uid('evt'), type: 'alert.escalated', projectRef: 'acmeprodxyzabcdefghij', agentId: null, occurredAt: hoursAgo(28), summary: 'SMS → on-call · no ack in 15m', level: 'warn' },
  ];

  return {
    version: 1,
    workspace: {
      id: uid('ws'),
      name: user.email?.split('@')[1]?.split('.')[0]
        ? `${user.email.split('@')[1].split('.')[0]} recovery`
        : 'Production recovery',
      slug: 'production',
      plan: 'cloud-intro-17',
      cloudVersion: user.cloudVersion || 'supabase',
      createdAt: daysAgo(40),
    },
    profile: {
      id: user.id || uid('user'),
      email: user.email || 'you@company.com',
      name: user.name || 'Operator',
      role: 'owner',
    },
    members: [
      { id: user.id || uid('user'), email: user.email || 'you@company.com', name: user.name || 'Operator', role: 'owner', lastActiveAt: hoursAgo(0.1) },
      { id: uid('user'), email: 'oncall@company.com', name: 'On-call lead', role: 'admin', lastActiveAt: hoursAgo(6) },
      { id: uid('user'), email: 'founder@company.com', name: 'Founder', role: 'member', lastActiveAt: daysAgo(2) },
    ],
    projects: [
      {
        id: projectA,
        ref: 'kiuwcdpjsdotkoojbkoi',
        name: 'Primary app',
        region: 'us-east-1',
        status: 'healthy',
        scheduleEveryHours: 12,
        lastSuccessAt: hoursAgo(2.1),
        lastFailureAt: daysAgo(4),
        rpoHours: 2.1,
        rpoTargetHours: 12,
        agentId: agentA,
        destinationIds: [destA, destB],
        layers: { database: true, auth: true, storage: true, functions: true },
        createdAt: daysAgo(35),
      },
      {
        id: projectB,
        ref: 'acmeprodxyzabcdefghij',
        name: 'Billing service',
        region: 'eu-west-1',
        status: 'degraded',
        scheduleEveryHours: 12,
        lastSuccessAt: hoursAgo(5),
        lastFailureAt: hoursAgo(29),
        rpoHours: 5,
        rpoTargetHours: 12,
        agentId: agentB,
        destinationIds: [destA],
        layers: { database: true, auth: true, storage: true, functions: false },
        createdAt: daysAgo(20),
      },
    ],
    agents: [
      {
        id: agentA,
        name: 'backup-box-1',
        hostname: 'backup-box-1',
        status: 'online',
        version: '0.4.0',
        projectId: projectA,
        lastSeenAt: hoursAgo(0.4),
        tokenPrefix: 'pb_live_a8f3',
        tokenHint: '••••••••c4e2',
        os: 'linux',
        createdAt: daysAgo(30),
      },
      {
        id: agentB,
        name: 'nas-runner',
        hostname: 'nas-runner.local',
        status: 'degraded',
        version: '0.4.0',
        projectId: projectB,
        lastSeenAt: hoursAgo(3.2),
        tokenPrefix: 'pb_live_b1c9',
        tokenHint: '••••••••91aa',
        os: 'linux',
        createdAt: daysAgo(18),
      },
    ],
    destinations: [
      { id: destA, name: 'AWS S3 · recover-prod', kind: 's3', status: 'ok', path: 's3://company-portabase/prod', lastWriteAt: hoursAgo(2.1), createdAt: daysAgo(34) },
      { id: destB, name: 'Dropbox · DR vault', kind: 'dropbox', status: 'ok', path: 'dropbox:Portabase/capsules', lastWriteAt: hoursAgo(38), createdAt: daysAgo(28) },
      { id: uid('dest'), name: 'Google Drive (warm)', kind: 'gdrive', status: 'idle', path: 'gdrive:Portabase', lastWriteAt: daysAgo(12), createdAt: daysAgo(15) },
    ],
    capsules,
    schedules: [
      { id: uid('sch'), projectId: projectA, everyHours: 12, timezone: 'America/New_York', enabled: true, nextRunAt: hoursAgo(-9.9), lastRunAt: hoursAgo(2.1) },
      { id: uid('sch'), projectId: projectB, everyHours: 12, timezone: 'UTC', enabled: true, nextRunAt: hoursAgo(-7), lastRunAt: hoursAgo(5) },
    ],
    restores: [
      {
        id: uid('rpl'),
        kind: 'replay',
        projectId: projectA,
        sourceRef: 'kiuwcdpjsdotkoojbkoi',
        mode: 'replay',
        status: 'passed',
        evidenceStatus: 'RECOVERY_DATA_PATH_VERIFIED',
        targetRef: 'newacctfreshproj001234',
        startedAt: daysAgo(7),
        finishedAt: daysAgo(7),
        durationMs: 892_000,
        capsuleId: capsules[2].id,
        steps: [
          { id: 'select', label: 'Select capsule', status: 'ok', detail: 'Verified COMPLETE capsule' },
          { id: 'decrypt', label: 'Decrypt & authenticate', status: 'ok', detail: 'AES-256-GCM + checksums' },
          { id: 'guard', label: 'Refuse source target', status: 'ok', detail: 'Target ≠ source ref' },
          { id: 'preflight', label: 'Blank-target preflight', status: 'ok', detail: '0 tables · 0 auth · 0 storage · 0 functions' },
          { id: 'restore', label: 'Restore layers', status: 'ok', detail: 'DB · Auth · Storage · Functions' },
          { id: 'proof', label: 'Read-back proof', status: 'ok', detail: 'Inventory matches capsule layers' },
        ],
      },
      { id: uid('rst'), kind: 'drill', projectId: projectA, sourceRef: 'kiuwcdpjsdotkoojbkoi', mode: 'drill', status: 'completed', evidenceStatus: 'PARTIAL_OK', targetRef: 'drill-restore-2026-07', startedAt: daysAgo(14), finishedAt: daysAgo(14), durationMs: 412_000, capsuleId: capsules[2].id, steps: [] },
    ],
    alertChannels: [
      { id: uid('ch'), kind: 'sms', label: 'On-call mobile', config: { to: '+1 ••• ••• 4821' }, enabled: true },
      { id: uid('ch'), kind: 'email', label: 'Ops inbox', config: { to: 'ops@company.com' }, enabled: true },
      { id: uid('ch'), kind: 'slack', label: '#incidents', config: { channel: '#incidents' }, enabled: true },
      { id: uid('ch'), kind: 'webhook', label: 'PagerDuty bridge', config: { url: 'https://events.pagerduty.com/…' }, enabled: false },
    ],
    /** SMS text management — success/failure at run time */
    sms: {
      onFailure: true,
      onSuccess: true,
      quietHoursEnabled: false,
      quietStart: '22:00',
      quietEnd: '07:00',
      timezone: 'America/New_York',
      numbers: [
        { id: uid('sms'), e164: '+15551234821', label: 'On-call', verified: true, enabled: true },
        { id: uid('sms'), e164: '+15559876001', label: 'Founder', verified: true, enabled: true },
      ],
      recent: [
        { id: uid('dlv'), at: hoursAgo(2.1), event: 'backup.completed', to: '+15551234821', status: 'sent', body: 'Portabase OK · Primary app · COMPLETE' },
        { id: uid('dlv'), at: hoursAgo(29), event: 'backup.failed', to: '+15551234821', status: 'sent', body: 'Portabase FAIL · billing · destination_unreachable' },
        { id: uid('dlv'), at: hoursAgo(29), event: 'backup.failed', to: '+15559876001', status: 'sent', body: 'Portabase FAIL · billing · destination_unreachable' },
      ],
    },
    alertPolicies: [
      {
        id: policyA,
        name: 'Production lockout chain',
        eventTypes: ['backup.failed', 'schedule.missed', 'verify.failed'],
        enabled: true,
        steps: [
          { order: 1, delaySeconds: 0, channelLabel: 'Ops inbox' },
          { order: 2, delaySeconds: 900, channelLabel: 'On-call mobile' },
          { order: 3, delaySeconds: 1800, channelLabel: '#incidents' },
        ],
      },
      {
        id: uid('pol'),
        name: 'SMS at every run (success + failure)',
        eventTypes: ['backup.completed', 'backup.failed'],
        enabled: true,
        steps: [
          { order: 1, delaySeconds: 0, channelLabel: 'On-call mobile' },
        ],
      },
    ],
    runners: [
      { id: uid('run'), name: 'managed-primary', isolation: 'L1', status: 'running', projectId: projectA, ecsService: 'portabase-ws-…-svc', lastError: null, tailscale: false, updatedAt: hoursAgo(1) },
      { id: uid('run'), name: 'managed-billing', isolation: 'L1', status: 'stopped', projectId: projectB, ecsService: null, lastError: 'Scaled to zero · resume from console', tailscale: false, updatedAt: daysAgo(3) },
    ],
    events,
    billing: {
      status: 'trialing',
      trialEndsAt: new Date(Date.now() + 5 * 86400e3).toISOString(),
      priceMonthlyCents: 1700,
      listPriceMonthlyCents: 2700,
      plan: 'cloud-17',
      planId: 'cloud-17',
      paymentMethod: 'Visa •••• 4242',
      cloudVersion: user.cloudVersion || 'supabase',
      /** Daily Escape = 1 escape / 24h; Triple Escape = up to 3 escapes / day */
      includedCyclesPerDay: 1,
      cyclesUsedLast24h: 1,
    },
    settings: {
      telemetryOptIn: true,
      retainEventsDays: 90,
      requireVerifyGreen: true,
      timezone: 'America/New_York',
      notifyOnSuccess: false,
    },
    /** Customer CloudTrail live view — role in their account; events never include secrets */
    auditTrail: {
      enabled: true,
      livePollSeconds: 20,
      region: 'us-east-1',
      roleArn: '',
      externalId: '',
      vaultPrefixHint: 's3://company-portabase/prod',
      connected: false,
      lastPolledAt: null,
      mode: 'demo',
    },
    /**
     * CloudWatch live — Portabase job logs scoped to a secret.
     * Group: /portabase/tenants/{workspaceId}/secrets/{secretId}
     * Always recorded; customer can open retroactively within retention.
     */
    cloudWatchLive: {
      enabled: true,
      livePollSeconds: 8,
      region: 'us-east-1',
      secretId: 'sec_prod_primary',
      secretLabel: 'Primary Supabase source (scoped)',
      workspaceId: null,
      lastPolledAt: null,
      mode: 'demo',
    },
    secrets: [
      {
        id: 'sec_prod_primary',
        label: 'Primary Supabase source',
        kind: 'supabase_source',
        projectRef: 'kiuwcdpjsdotkoojbkoi',
        lastUsedAt: hoursAgo(2.1),
        logGroupHint: '/portabase/tenants/…/secrets/sec_prod_primary',
      },
      {
        id: 'sec_vault_s3',
        label: 'S3 vault write role',
        kind: 'destination_aws',
        projectRef: null,
        lastUsedAt: hoursAgo(2.1),
        logGroupHint: '/portabase/tenants/…/secrets/sec_vault_s3',
      },
      {
        id: 'sec_kms_cmk',
        label: 'Customer KMS grant',
        kind: 'kms_grant',
        projectRef: null,
        lastUsedAt: hoursAgo(14),
        logGroupHint: '/portabase/tenants/…/secrets/sec_kms_cmk',
      },
    ],
    onboarding: {
      completed: false,
      steps: { workspace: true, project: true, agent: false, destination: true, schedule: true, alert: false, drill: false },
    },
  };
}

export function loadConsoleState(user) {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data?.workspace && data?.projects) {
        if (user?.email) data.profile = { ...data.profile, email: user.email, name: user.name || data.profile.name, id: user.id || data.profile.id };
        if (user?.cloudVersion) {
          data.workspace.cloudVersion = user.cloudVersion;
          data.billing = { ...data.billing, cloudVersion: user.cloudVersion };
        }
        return data;
      }
    }
  } catch {
    /* seed */
  }
  const seeded = seedWorkspace(user || {});
  saveConsoleState(seeded);
  return seeded;
}

export function saveConsoleState(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent('portabase-console', { detail: state }));
}

export function updateConsoleState(mutator) {
  const current = loadConsoleState();
  const next = mutator(structuredClone(current));
  saveConsoleState(next);
  return next;
}

export function resetConsoleState(user) {
  localStorage.removeItem(KEY);
  return loadConsoleState(user);
}

export function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export function formatDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function relativeTime(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  const d = Date.now() - t;
  const future = d < 0;
  const abs = Math.abs(d);
  const min = Math.round(abs / 60e3);
  const hr = Math.round(abs / 3600e3);
  const day = Math.round(abs / 86400e3);
  let label;
  if (min < 1) label = 'just now';
  else if (min < 60) label = `${min}m`;
  else if (hr < 48) label = `${hr}h`;
  else label = `${day}d`;
  return future ? `in ${label}` : `${label} ago`;
}

export function rpoStatus(project) {
  if (project.rpoHours == null) return { tone: 'danger', label: 'No success' };
  if (project.rpoHours <= project.rpoTargetHours) return { tone: 'ok', label: 'Within RPO' };
  if (project.rpoHours <= project.rpoTargetHours * 2) return { tone: 'warn', label: 'Approaching breach' };
  return { tone: 'danger', label: 'RPO breached' };
}

export { uid };
