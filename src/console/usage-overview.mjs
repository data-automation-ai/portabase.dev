const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export function usageBytes(value) {
  if (!finite(value)) return '—';
  if (value < 1000) return `${Math.round(value)} B`;
  const unit = value >= 1e12 ? 1e12 : value >= 1e9 ? 1e9 : value >= 1e6 ? 1e6 : 1e3;
  return `${new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(value / unit)} ${unit === 1e12 ? 'TB' : unit === 1e9 ? 'GB' : unit === 1e6 ? 'MB' : 'KB'}`;
}
export function usageDuration(ms) {
  if (!finite(ms)) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
}
export function usageDate(value, time = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not recorded';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', ...(time ? { hour: 'numeric', minute: '2-digit' } : {}) }).format(new Date(value));
}
export function backupVerification(job) {
  if (!job) return { tone: 'pending', title: 'Awaiting first backup', detail: 'Run a backup to record its duration, transfer size, and verification result.' };
  if (job.status === 'running') return { tone: 'pending', title: 'Backup in progress', detail: 'Completeness is not confirmed until the backup finishes.' };
  if (job.status === 'failed') return { tone: 'failed', title: 'Backup failed', detail: 'This run did not produce a verified recovery copy.' };
  if (job.status !== 'succeeded' || job.verified !== true || job.manifestVerified !== true)
    return { tone: 'pending', title: 'Verification incomplete', detail: 'A successful job alone does not confirm integrity and manifest completeness.' };
  if (job.completeness === 'complete') return { tone: 'verified', title: 'Complete · integrity verified', detail: 'The runner verified the backup and its manifest. A restore drill is a separate check.' };
  if (job.completeness === 'selected') return { tone: 'verified', title: 'Selected scope verified', detail: 'The selected objects and manifest were verified. This is not a full-project backup.' };
  return { tone: 'pending', title: 'Completeness unverified', detail: 'Integrity checks passed, but complete coverage has not been confirmed.' };
}
export function usageView(snapshot = {}) {
  const usage = snapshot?.usage;
  const runtime = snapshot?.runnerUsage;
  const available = usage?.available === true;
  const recorded = available && usage.recorded === true;
  const allowance = available && finite(usage.allowanceBytes) && usage.allowanceBytes > 0 ? usage.allowanceBytes : null;
  const charged = recorded && finite(usage.chargedBytes) ? usage.chargedBytes : null;
  const runtimeMeasured = runtime?.available === true && runtime.status === 'measured' && finite(runtime.runnerRuntimeMs);
  return { available, recorded, allowance, charged,
    usedPercent: charged !== null && allowance ? Math.min(100, charged / allowance * 100) : null,
    remaining: charged !== null && allowance ? Math.max(0, allowance - charged - (finite(usage.reservedBytes) ? usage.reservedBytes : 0)) : null,
    runnerHours: runtimeMeasured ? new Intl.NumberFormat('en', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(runtime.runnerRuntimeMs / 3600000) : null,
    runtimeMeasured,
    verification: backupVerification(available ? usage.lastBackup : null),
  };
}
