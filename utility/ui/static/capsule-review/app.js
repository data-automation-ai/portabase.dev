const $ = id => document.getElementById(id);
const token = new URLSearchParams(location.hash.slice(1)).get('t') || '';
history.replaceState(null, '', location.pathname);
let csrf = '', current = null, savedPlan = null, savedIntent = null, sharedSummary = null, configuredTarget = '', busy = false;
const selected = { tables: new Set(), buckets: new Set(), functions: new Set() };
const messages = {
  capsule_authentication_failed: 'The capsule could not be authenticated. Check the runner passphrase and capsule files.',
  capsule_passphrase_required: 'Configure the capsule passphrase in the runner environment, then restart this private view.',
  capsule_review_limit: 'This capsule exceeds a configured inspection limit. Review the runner limits before trying again.',
  capsule_changed: 'The capsule changed. Inspect it again before saving.', capsule_review_changed: 'This review is no longer current. Inspect again before saving.',
  capsule_baseline_required: 'This is a delta capsule and requires its full baseline. This view currently reviews full capsules only.',
  unsupported_capsule_archive: 'This archive format or entry type is unsupported for private review. No plan was saved.',
  unsupported_capsule_sql: 'The SQL dump cannot be safely measured by this review tool. No plan was saved.',
  restore_plan_over_budget: 'The selection exceeds your data budget. Inspect again, then reduce the selection or change the budget.',
  empty_restore_selection: 'Confirm that you intend to save an empty selection.',
  private_replay_setup_required: 'Configure the engine file and a different recovery target on this runner, then reopen this view.',
  replay_target_confirmation_required: 'Retype the exact configured recovery target reference.',
  invalid_replay_confirmation: 'Confirm that you want to prepare a replay reference for this saved selection.',
  restore_plan_binding_mismatch: 'The saved plan or capsule changed. Inspect and save the selection again.',
  restore_plan_changed: 'The saved plan changed. Inspect and save the selection again.',
};
const key = (kind, row) => kind === 'tables' ? `${row.schema}.${row.table}` : kind === 'buckets' ? row.id : row.name;
const size = bytes => `${bytes.toLocaleString()} B`;
function error(message) { $('error').textContent = message; $('error').hidden = false; }
async function request(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', headers: {
    'X-Portabase-Session': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Portabase-CSRF': csrf }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(messages[result.error] || 'Private capsule review is unavailable. Check this runner and inspect again.');
  return result;
}
function summary() {
  $('inspect').disabled = busy || !csrf;
  $('create-replay').disabled = busy || !savedPlan || !configuredTarget || $('confirm-target').value !== configuredTarget || !$('confirm-replay').checked;
  $('confirm-target').disabled = busy || !savedPlan;
  $('confirm-replay').disabled = busy || !savedPlan;
  $('download').disabled = busy || !savedIntent;
  $('preview-sharing').disabled = busy || !current;
  $('download-sharing').disabled = busy || !sharedSummary;
  const count = Object.values(selected).reduce((sum, values) => sum + values.size, 0);
  const bytes = current ? ['tables', 'buckets'].reduce((sum, kind) => sum + current[kind].filter(row => selected[kind].has(key(kind, row))).reduce((total, row) => total + row.bytes, 0), 0) : 0;
  const budget = Number($('budget').value);
  $('save').disabled = !current || busy || !Number.isSafeInteger(budget) || budget <= 0 || bytes > budget || (!count && !$('empty').checked);
  for (const input of $('review').querySelectorAll('input')) input.disabled = !current || busy;
  if (!current) return;
  $('summary').textContent = `${selected.tables.size} tables · ${selected.buckets.size} buckets · ${selected.functions.size} functions · ${size(bytes)} selected`;
  $('budget-warning').textContent = bytes > budget ? 'Over the selected data budget.' : '';
}
function choices(kind) {
  const parent = $(kind); parent.replaceChildren();
  if (!current[kind].length) { parent.textContent = `No selectable ${kind} were found in this capsule.`; return; }
  for (const row of current[kind]) {
    const name = key(kind, row), label = document.createElement('label'); label.className = 'choice';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = true;
    checkbox.setAttribute('aria-label', `Select ${kind === 'tables' ? 'table' : kind === 'buckets' ? 'bucket' : 'function'} ${name}`);
    checkbox.addEventListener('change', () => { checkbox.checked ? selected[kind].add(name) : selected[kind].delete(name); summary(); });
    const text = document.createElement('code'); text.textContent = name; const detail = document.createElement('small'); detail.textContent = row.bytes === undefined ? 'Size excluded from estimate' : size(row.bytes);
    label.append(checkbox, text, detail); parent.append(label);
  }
}
$('inspect').addEventListener('click', async () => {
  if (busy) return; busy = true; current = null; savedPlan = null; savedIntent = null; sharedSummary = null;
  $('sharing-preview').hidden = true; $('sharing-json').textContent = '';
  $('review').hidden = true; $('saved').hidden = true; $('replay-reference').hidden = true; $('error').hidden = true; $('empty').checked = false;
  $('confirm-target').value = ''; $('confirm-replay').checked = false;
  $('progress').textContent = 'Authenticating and scanning the configured capsule…'; summary();
  try {
    current = await request('/api/review/inspect', {});
    $('identity').textContent = `${current.capsuleId} · ${current.status} · ${current.createdAt}`;
    $('components').replaceChildren();
    for (const component of current.components) { const p = document.createElement('span'); p.textContent = `${component.name}: ${component.skipped ? 'skipped' : component.limited ? 'limited' : component.complete ? 'captured' : 'incomplete'}`; $('components').append(p); }
    $('log').replaceChildren();
    if (!current.captureLog) $('log').textContent = 'No capture log is available in this capsule.';
    else {
      if (current.captureLog.truncated) {
        const notice = document.createElement('p'); notice.setAttribute('role', 'status');
        notice.textContent = 'This capture log was truncated. Some capture events are not included.';
        $('log').append(notice);
      }
      for (const row of current.captureLog.records) { const p = document.createElement('p'); p.textContent = `${row.at} · ${row.component || 'capture'} · ${row.outcome || row.status || row.event}`; $('log').append(p); }
    }
    $('data-note').textContent = current.hasData ? 'Sizes measure COPY data blocks in the authenticated SQL dump.' : 'This capsule has no database data dump. No table-row selection is available.';
    for (const kind of ['tables', 'buckets', 'functions']) { selected[kind] = new Set(current[kind].map(row => key(kind, row))); choices(kind); }
    $('review').hidden = false; $('progress').textContent = 'Capsule inspected privately.';
  } catch (failure) { error(failure.message); $('progress').textContent = 'No current capsule review.'; }
  finally { busy = false; summary(); }
});
$('preview-sharing').addEventListener('click', async () => {
  if (busy || !current) return;
  busy = true; sharedSummary = null; $('sharing-preview').hidden = true; $('error').hidden = true; summary();
  try {
    sharedSummary = await request('/api/review/shareable-summary', { revision: current.revision });
    $('sharing-json').textContent = JSON.stringify(sharedSummary, null, 2); $('sharing-preview').hidden = false;
    $('progress').textContent = 'Summary preview ready. Nothing has been uploaded.';
  } catch (failure) { current = null; error(failure.message); }
  finally { busy = false; summary(); }
});
$('download-sharing').addEventListener('click', () => {
  if (busy || !sharedSummary) return;
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(sharedSummary, null, 2)}\n`], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'portabase-shareable-summary.json'; link.click(); URL.revokeObjectURL(url);
});
$('budget').addEventListener('input', summary); $('empty').addEventListener('change', summary);
$('save').addEventListener('click', async () => {
  if (busy || !current || $('save').disabled) return;
  busy = true; $('error').hidden = true; summary();
  try {
    const result = await request('/api/review/plans', { revision: current.revision, selectedTables: [...selected.tables], selectedBuckets: [...selected.buckets],
      selectedFunctions: [...selected.functions], maxBytes: Number($('budget').value), confirmEmpty: $('empty').checked });
    $('saved-detail').textContent = `${result.capsuleId} · ${size(result.selectedBytes)} selected`;
    savedPlan = result; savedIntent = null;
    $('plan-path').textContent = result.planPath; $('saved').hidden = false; $('progress').textContent = 'Plan saved. No restore has started.';
    $('replay-controls').hidden = !configuredTarget; $('replay-unavailable').hidden = Boolean(configuredTarget);
  } catch (failure) { error(failure.message); }
  finally { busy = false; current = null; summary(); }
});
$('confirm-target').addEventListener('input', summary); $('confirm-replay').addEventListener('change', summary);
$('create-replay').addEventListener('click', async () => {
  if (busy || !savedPlan || $('create-replay').disabled) return;
  busy = true; $('error').hidden = true; summary();
  try {
    savedIntent = await request('/api/review/replay-reference', { planRef: savedPlan.planRef, bindingSha256: savedPlan.bindingSha256,
      targetRef: configuredTarget, confirmTarget: $('confirm-target').value, confirmReplay: $('confirm-replay').checked });
    $('intent').textContent = JSON.stringify(savedIntent, null, 2); $('replay-reference').hidden = false;
    $('progress').textContent = 'Replay reference prepared. No job has been queued.';
  } catch (failure) { error(failure.message); }
  finally { busy = false; savedPlan = null; summary(); }
});
$('download').addEventListener('click', () => {
  if (!savedIntent) return;
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(savedIntent, null, 2)}\n`], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'portabase-replay-reference.json'; link.click(); URL.revokeObjectURL(url);
});
try { const initial = await request('/api/review'); csrf = initial.csrf; configuredTarget = initial.replayConfigured ? initial.targetRef : '';
  $('target-ref').textContent = configuredTarget; $('runner').textContent = initial.runnerId; $('project').textContent = initial.projectRef;
  $('progress').textContent = 'Ready to inspect. No source connection needed.'; summary(); }
catch (failure) { error(failure.message); }
