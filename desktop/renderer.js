const $ = id => document.getElementById(id);
const secretValues = () => ({
  SUPABASE_DB_URL: $('sourceDb').value, SUPABASE_URL: $('sourceUrl').value,
  SUPABASE_SERVICE_ROLE_KEY: $('sourceService').value, SUPABASE_ACCESS_TOKEN: $('sourceAccess').value,
  PORTABASE_ENCRYPTION_PASSPHRASE: $('passphrase').value,
});
const targetValues = () => ({
  PORTABASE_TARGET_DB_URL: $('targetDb').value, PORTABASE_TARGET_SUPABASE_URL: $('targetUrl').value,
  PORTABASE_TARGET_SERVICE_ROLE_KEY: $('targetService').value, PORTABASE_TARGET_PROJECT_REF: $('targetRef').value,
  SUPABASE_ACCESS_TOKEN: $('targetAccess').value, PORTABASE_ENCRYPTION_PASSPHRASE: $('passphrase').value,
});

function show(page) {
  document.querySelectorAll('.page,.nav').forEach(el => el.classList.remove('active'));
  $(page).classList.add('active');
  document.querySelector(`.nav[data-page="${page}"]`)?.classList.add('active');
}
function result(text, failed = false) {
  $('output').textContent = text || 'Task finished without output.';
  $('output').classList.toggle('failed', failed);
  show('results');
}
async function run(command, args, secrets) {
  result('Running locally…');
  const response = await window.portabase.run({ command, args, secrets });
  result(response.output, response.code !== 0);
}

document.querySelectorAll('.nav').forEach(button => button.addEventListener('click', () => show(button.dataset.page)));
document.querySelector('[data-pick="destination"]').addEventListener('click', async () => { $('destination').value = await window.portabase.chooseDirectory() || $('destination').value; });
document.querySelector('[data-pick="capsule"]').addEventListener('click', async () => { $('capsule').value = await window.portabase.chooseCapsule() || $('capsule').value; });
$('buy').addEventListener('click', () => window.portabase.open('https://portabase.dev/buy'));
$('newAccount').addEventListener('click', () => window.portabase.open('https://supabase.com/dashboard/sign-up'));
$('newToken').addEventListener('click', () => window.portabase.open('https://supabase.com/dashboard/account/tokens'));
$('loadOrgs').addEventListener('click', async () => {
  try {
    $('provisionStatus').textContent = 'Connecting directly to Supabase…';
    const organizations = await window.portabase.listOrganizations($('targetAccess').value);
    $('targetOrg').replaceChildren(new Option('Choose an organization', ''), ...organizations.map(org => new Option(org.name, org.slug)));
    $('provisionStatus').textContent = `Connected. Found ${organizations.length} organization${organizations.length === 1 ? '' : 's'}.`;
  } catch (error) { $('provisionStatus').textContent = error.message; }
});
$('createProject').addEventListener('click', async () => {
  try {
    if (!confirm('Create a blank Supabase project in the selected organization? This may affect that organization’s Supabase billing. No data will be restored until a separate write guard is confirmed.')) return;
    $('provisionStatus').textContent = 'Supabase is creating the blank recovery project…';
    const project = await window.portabase.createProject({ token: $('targetAccess').value, organizationSlug: $('targetOrg').value, name: $('targetName').value, region: $('targetRegion').value, dbPassword: $('targetDbPassword').value });
    $('targetRef').value = project.ref; $('targetUrl').value = project.url;
    $('provisionStatus').textContent = `Created ${project.ref} (${project.status}). When Supabase finishes provisioning it, click Prepare credentials.`;
  } catch (error) { $('provisionStatus').textContent = error.message; }
});
$('refreshProject').addEventListener('click', async () => {
  try {
    $('provisionStatus').textContent = 'Reading the new project credentials directly from Supabase…';
    const project = await window.portabase.projectCredentials({ token: $('targetAccess').value, ref: $('targetRef').value, dbPassword: $('targetDbPassword').value });
    $('targetRef').value = project.ref; $('targetUrl').value = project.url; $('targetDb').value = project.dbUrl; $('targetService').value = project.adminKey;
    $('provisionStatus').textContent = `Credentials prepared locally. Project status: ${project.status}. Run the no-write plan next.`;
  } catch (error) { $('provisionStatus').textContent = error.message; }
});
$('saveSource').addEventListener('click', async () => {
  try {
    await window.portabase.saveConfig({ projectRef: $('projectRef').value, destination: $('destination').value });
    await window.portabase.saveSecrets(secretValues());
    result('Saved locally using protected operating-system storage. PortaBase did not transmit these values.');
  } catch (error) { result(error.message, true); }
});
$('doctor').addEventListener('click', async () => {
  try { await window.portabase.saveConfig({ projectRef: $('projectRef').value, destination: $('destination').value }); await run('doctor', [], secretValues()); }
  catch (error) { result(error.message, true); }
});
$('trial').addEventListener('click', async () => {
  try { await window.portabase.saveConfig({ projectRef: $('projectRef').value, destination: $('destination').value }); await run('backup', ['--trial'], secretValues()); }
  catch (error) { result(error.message, true); }
});
$('dryRun').addEventListener('click', () => run('restore', ['--capsule', $('capsule').value, '--preflight'], targetValues()));
$('drillRestore').addEventListener('click', async () => {
  const target = $('targetRef').value.trim();
  if (!target || $('typedRef').value.trim() !== target) return result('Restore drill refused: type the exact NEW project reference in the write guard.', true);
  if (!confirm('Write the deliberately limited trial sample into this disposable project? This is validation, not a complete recovery.')) return;
  await run('restore', ['--capsule', $('capsule').value, '--drill', '--confirm-target', target], targetValues());
});
$('executeRestore').addEventListener('click', async () => {
  const target = $('targetRef').value.trim();
  if (!target || $('typedRef').value.trim() !== target) return result('Restore refused: the typed confirmation must exactly match the NEW project reference.', true);
  await run('restore', ['--capsule', $('capsule').value, '--execute', '--confirm-target', target], targetValues());
});

window.portabase.state().then(state => {
  $('security').textContent = state.secureStorage ? '● OS-protected secret storage available' : '● Secure secret storage unavailable; values will not be persisted';
  $('security').classList.toggle('warn', !state.secureStorage);
  if (state.config) { $('projectRef').value = state.config.projectRef || ''; $('destination').value = state.config.provider?.path || ''; }
}).catch(error => result(error.message, true));
