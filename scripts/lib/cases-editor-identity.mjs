// Operator-only lookup. Never exposed through the public cases API.
export async function resolveCasesEditorEmail(supabase, authRef, email) {
  if (typeof email !== 'string' || email.length > 254 || !/^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) throw Error('exact_editor_email_required');
  if (!/^[a-z]{20}$/.test(authRef)) throw Error('auth_project_required');
  const normalized = email.toLowerCase();
  const escaped = normalized.replaceAll("'", "''");
  const rows = await supabase(`/projects/${authRef}/database/query`, {
    method: 'POST',
    body: JSON.stringify({query: `SELECT id, email, email_confirmed_at FROM auth.users WHERE lower(email) = '${escaped}' LIMIT 2`}),
  });
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.email?.toLowerCase() !== normalized || !rows[0]?.email_confirmed_at || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(rows[0]?.id || '')) throw Error('exactly_one_verified_editor_required');
  return rows[0].id;
}
