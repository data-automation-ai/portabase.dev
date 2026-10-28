import { recoveryKeyBytes, sealProfile, openProfile } from './customer-profile.mjs';
import { oauthConnections } from './oauth-connections.mjs';
import { engineJobs } from './engine-jobs.mjs';
import { projectRef } from './supabase-access.mjs';
import { dropboxVault } from './dropbox-vault.mjs';
import { s3Vault } from './s3-vault.mjs';
import { r2Vault } from './r2-vault.mjs';
const fail = code => { throw new Error(code); };
const TABLE_SELECTION = /^[A-Za-z_][A-Za-z0-9_$]*\.[A-Za-z0-9_$]+$/;
const BUCKET_SELECTION = /^[A-Za-z0-9._-]{1,100}$/;
async function sourceInventory(api, ref) {
  const [tableRows, bucketRows, project] = await Promise.all([
    api.query(ref, `SELECT n.nspname AS schema_name, c.relname AS table_name,
      GREATEST(c.reltuples,0)::bigint::text AS estimated_rows,
      pg_total_relation_size(c.oid)::bigint::text AS size_bytes
      FROM pg_catalog.pg_tables t
      JOIN pg_catalog.pg_namespace n ON n.nspname=t.schemaname
      JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=t.tablename AND c.relkind IN ('r','p')
      WHERE t.schemaname NOT IN ('information_schema','_analytics','_realtime','_supavisor','auth','cron','dbdev','extensions','graphql','graphql_public','net','pgbouncer','pgmq','pgsodium','pgsodium_masks','pgtle','realtime','repack','storage','supabase_functions','supabase_migrations','tiger','tiger_data','topology','vault')
        AND t.schemaname !~ '^pg_' AND t.schemaname !~ '^_timescaledb_'
      ORDER BY n.nspname,c.relname LIMIT 5001`),
    api.query(ref, `SELECT b.id AS bucket_id, count(o.id)::text AS object_count,
      COALESCE(sum(CASE WHEN o.metadata->>'size' ~ '^[0-9]+$' THEN (o.metadata->>'size')::numeric ELSE 0 END),0)::text AS size_bytes
      FROM storage.buckets b LEFT JOIN storage.objects o ON o.bucket_id=b.id
      GROUP BY b.id ORDER BY b.id LIMIT 1001`),
    api.inspect(ref),
  ]);
  if (!Array.isArray(tableRows) || !Array.isArray(bucketRows)) fail('source_inventory_unavailable');
  if (tableRows.length > 5000 || bucketRows.length > 1000) fail('source_inventory_limit_exceeded');
  const tables = tableRows.map(row => {
    const name = `${String(row.schema_name)}.${String(row.table_name)}`;
    const bytes = Number(row.size_bytes), estimatedRows = Number(row.estimated_rows);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isFinite(estimatedRows)) fail('source_inventory_invalid');
    return { name, schema: String(row.schema_name), table: String(row.table_name), bytes,
      estimatedRows: Math.max(0, Math.floor(estimatedRows)), selectable: TABLE_SELECTION.test(name) };
  });
  const buckets = bucketRows.map(row => {
    const id = String(row.bucket_id), bytes = Number(row.size_bytes), objects = Number(row.object_count);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(objects) || objects < 0) fail('source_inventory_invalid');
    return { id, bytes, objects, selectable: BUCKET_SELECTION.test(id) };
  });
  return { ref, tables, buckets, functions: project.functions, authUsers: project.authUsers,
    tableBytes: tables.reduce((sum, row) => sum + row.bytes, 0),
    storageBytes: buckets.reduce((sum, row) => sum + row.bytes, 0),
    checkedAt: new Date().toISOString() };
}
async function captureScope(api, ref, requested) {
  if (!requested || !Array.isArray(requested.tables) || !Array.isArray(requested.buckets)
    || typeof requested.auth !== 'boolean' || typeof requested.functions !== 'boolean') fail('source_scope_required');
  const inventory = await sourceInventory(api, ref);
  const tableSet = new Set(inventory.tables.map(row => row.name));
  const bucketSet = new Set(inventory.buckets.map(row => row.id));
  const tables = [...new Set(requested.tables)];
  const buckets = [...new Set(requested.buckets)];
  if (tables.some(name => typeof name !== 'string' || !tableSet.has(name))
    || buckets.some(id => typeof id !== 'string' || !bucketSet.has(id))) fail('source_scope_stale');
  const allTables = tables.length === inventory.tables.length;
  const allBuckets = buckets.length === inventory.buckets.length;
  if (!allTables && inventory.tables.some(row => !row.selectable)) fail('selective_table_names_unsupported');
  if (buckets.some(id => !BUCKET_SELECTION.test(id))) fail('selective_bucket_names_unsupported');
  return {
    capture: { database: true, storage: buckets.length > 0, functions: requested.functions, auth: requested.auth,
      ...(!allTables ? (tables.length ? { includeTableData: tables } : { excludeTableData: inventory.tables.map(row => row.name) }) : {}),
      ...(allBuckets && buckets.length ? {} : buckets.length ? { includeBuckets: buckets } : {}) },
    summary: { tables: tables.length, totalTables: inventory.tables.length, buckets: buckets.length,
      totalBuckets: inventory.buckets.length, auth: requested.auth, functions: requested.functions,
      estimatedTableBytes: tables.reduce((sum, name) => sum + (inventory.tables.find(row => row.name === name)?.bytes || 0), 0),
      estimatedStorageBytes: buckets.reduce((sum, id) => sum + (inventory.buckets.find(row => row.id === id)?.bytes || 0), 0) },
  };
}
export function confidentialApplication({ oauthConfig, jobs = engineJobs(), connections = oauthConnections(oauthConfig),
  vault = oauthConfig?.dropboxClientId ? dropboxVault({clientId:oauthConfig.dropboxClientId}) : null, s3 = s3Vault(),r2=r2Vault(), admit, now = Date.now }) {
  const customers = new Map(), locks = new Set();
  return async ({owner,operation,input,authorization}) => {
    if (locks.has(owner)) fail('request_in_progress');
    locks.add(owner);
    try {
      let customer = customers.get(owner);
      if (operation === 'session.open') {
        recoveryKeyBytes(input.recoveryKey).fill(0);
        if (customer && customer.recoveryKey !== input.recoveryKey) fail('session_key_mismatch');
        if (!customer) {
          const profile = input.sealedProfile ? await openProfile(input.sealedProfile,input.recoveryKey,owner)
            : {version:1,owner,connections:{},selection:{},keyAcknowledged:false};
          customer = { profile, recoveryKey: input.recoveryKey, touched: now() };
          customers.set(owner,customer);
        }
      }
      if (!customer) fail('session_open_required');
      customer.touched=now();
      const {profile,recoveryKey} = customer;
      let data;
      switch(operation) {
        case 'session.open': data={ connected:{source:!!profile.connections.source,target:!!profile.connections.target,dropbox:!!profile.dropbox?.refreshToken,s3:!!profile.s3?.bucket,r2:!!profile.r2?.bucket,activeVault:profile.activeVault||(profile.s3?.bucket?'s3':'dropbox')},s3Summary:profile.s3?{bucket:profile.s3.bucket,region:profile.s3.region,prefix:profile.s3.prefix||'Portabase'}:null,r2Summary:profile.r2?{bucket:profile.r2.bucket,prefix:profile.r2.prefix}:null,selection:profile.selection,keyAcknowledged:!!profile.keyAcknowledged,accountConfirmation:profile.accountConfirmation?{confirmed:true,method:profile.accountConfirmation.method}:null }; break;
        case 'key.acknowledge': profile.keyAcknowledged=true; data={acknowledged:true}; break;
        case 'oauth.begin': data=connections.begin(profile,input.slot,input.redirectUri); break;
        case 'oauth.finish': data=await connections.finish(profile,input); break;
        case 'oauth.token': data=await connections.connectToken(profile,input); break;
        case 'oauth.disconnect': data=connections.disconnect(profile,input.slot); break;
        case 'oauth.identity': data={slot:input.slot,identity:await connections.identity(profile,input.slot)}; break;
        case 'oauth.account.confirm': data=connections.confirm(profile,input); break;
        case 'vault.begin': if(!vault)fail('dropbox_app_not_configured');data=vault.begin(profile,input.redirectUri);break;
        case 'vault.finish': if(!vault)fail('dropbox_app_not_configured');profile.activeVault='dropbox';data=await vault.finish(profile,input.state?{code:input.code,state:input.state}:input.code);break;
        case 'vault.s3.connect': data=await s3.connect(profile,input);break;
        case 'vault.s3.disconnect': delete profile.s3;if(profile.activeVault==='s3')profile.activeVault='dropbox';data={connected:false};break;
        case 'vault.r2.connect': data=await r2.connect(profile,input);break;
        case 'vault.r2.disconnect': delete profile.r2;if(profile.activeVault==='r2')profile.activeVault='dropbox';data={connected:false};break;
        case 'vault.select': profile.activeVault=['s3','r2'].includes(input.provider)?input.provider:'dropbox';data={activeVault:profile.activeVault};break;
        case 'vault.disconnect': delete profile.dropbox;delete profile.dropboxPending;data={connected:false};break;
        case 'vault.check': if(!vault)fail('dropbox_app_not_configured');data={connected:!!profile.dropbox?.refreshToken};
          if(data.connected)await vault.provider(profile);break;
        case 'projects.list': data={projects:await (await connections.access(profile,input.slot)).api.projects()}; break;
        case 'project.select': {
          const ref=projectRef(input.ref);
          const status=await (await connections.access(profile,input.slot)).api.inspect(ref);
          if(input.slot==='target' && (ref===profile.selection.source || ref==='eoiqvdmvgaurlecdzqkp')) fail('unsafe_restore_target');
          if(input.slot==='source' && ref===profile.selection.target) fail('unsafe_restore_target');
          profile.selection[input.slot]=ref;
          data=status; break;
        }
        case 'source.inventory': {
          if (!profile.selection.source) fail('source_project_required');
          const source=await connections.access(profile,'source');
          data={inventory:await sourceInventory(source.api,projectRef(profile.selection.source))}; break;
        }
        case 'vault.capsules': {
          data={ capsules: vault && profile.dropbox?.refreshToken ? await vault.capsules(profile) : [] }; break;
        }
        case 'preflight': {
          if (input?.mode === 'capsule_only') {
            const source = await connections.access(profile, 'source');
            const from = await source.api.inspect(projectRef(profile.selection.source));
            let to = null;
            if (profile.connections?.target && profile.selection?.target) {
              const target = await connections.access(profile, 'target');
              to = await target.api.inspect(projectRef(profile.selection.target));
              if (from.ref === to.ref || to.ref === 'eoiqvdmvgaurlecdzqkp') fail('unsafe_restore_target');
            }
            data = { source: from, target: to, keyAcknowledged: !!profile.keyAcknowledged,
              dataFlow: { source: 'Supabase', processor: 'Google Confidential Space', capsule: 'Encrypted in Dropbox', destination: 'None (capsule only)', verified: false },
              ready: !!profile.keyAcknowledged }; break;
          }
          if (input?.mode === 'restore_only') {
            const target = await connections.access(profile, 'target');
            const to = await target.api.inspect(projectRef(profile.selection.target));
            if (to.ref === 'eoiqvdmvgaurlecdzqkp') fail('unsafe_restore_target');
            let from = null;
            if (profile.connections?.source && profile.selection?.source) {
              const source = await connections.access(profile, 'source');
              from = await source.api.inspect(projectRef(profile.selection.source));
              if (from.ref === to.ref) fail('unsafe_restore_target');
            }
            data = { source: from, target: to, keyAcknowledged: !!profile.keyAcknowledged,
              dataFlow: { source: 'Existing capsule', processor: 'Google Confidential Space', capsule: 'Dropbox / Runner', destination: 'Customer-selected Supabase', verified: false },
              ready: (to.blank || input?.allowOverwrite === true) && !!profile.keyAcknowledged }; break;
          }
          if (connections.assertDistinct) await connections.assertDistinct(profile);
          const source = await connections.access(profile, 'source'), target = await connections.access(profile, 'target');
          const [from, to] = await Promise.all([source.api.inspect(projectRef(profile.selection.source)), target.api.inspect(projectRef(profile.selection.target))]);
          if (from.ref === to.ref || to.ref === 'eoiqvdmvgaurlecdzqkp') fail('unsafe_restore_target');
          data = { source: from, target: to, keyAcknowledged: !!profile.keyAcknowledged,
            dataFlow: { source: 'Supabase', processor: 'Google Confidential Space', capsule: 'Encrypted inside runner', destination: 'Customer-selected Supabase', verified: false },
            ready: (to.blank || input?.allowOverwrite === true) && !!profile.keyAcknowledged }; break;
        }
        case 'backup.start':
        case 'restore.start': {
          if (operation === 'backup.start' && input.vault !== undefined && !['dropbox', 'temporary_runner', 'capsule_only', 'restore_only'].includes(input.vault)) fail('unsupported_vault');
          if (!profile.keyAcknowledged) fail('save_recovery_key_first');
          const isCapsuleOnly = operation === 'backup.start' && input.vault === 'capsule_only';
          const isRestoreOnly = operation === 'restore.start' && (input.vault === 'restore_only' || !!input.dropboxCapsuleId);
          if (connections.assertDistinct && !isCapsuleOnly && !isRestoreOnly) await connections.assertDistinct(profile);

          let source = null, sourceRef = null;
          if (profile.selection?.source && profile.connections?.source) {
            source = await connections.access(profile, 'source');
            sourceRef = projectRef(profile.selection.source);
          } else if (operation === 'backup.start') {
            source = await connections.access(profile, 'source');
            sourceRef = projectRef(profile.selection.source);
          } else if (input.dropboxCapsuleId) {
            sourceRef = String(input.dropboxCapsuleId).split('-')[0];
          }

          let target = null, targetRef = null;
          if (profile.selection?.target && profile.connections?.target) {
            target = await connections.access(profile, 'target');
            targetRef = projectRef(profile.selection.target);
          } else if (operation === 'restore.start') {
            target = await connections.access(profile, 'target');
            targetRef = projectRef(profile.selection.target);
          }

          if (operation === 'restore.start' && ((input.confirmTarget !== undefined && input.confirmTarget !== targetRef) || input.acknowledgeManualConfig !== true)) fail('restore_acknowledgement_required');
          if (typeof admit !== 'function') fail('quota_service_unavailable');
          const admission = await admit({ authorization, operation: 'quota.inspect', requestId: input.requestId });

          const wantsVault = operation === 'backup.start' && ['dropbox', 'capsule_only'].includes(input.vault);
          const selectedVault=input.vaultProvider||profile.activeVault;
          const useS3=(wantsVault||operation==='restore.start')&&selectedVault==='s3';
          const useR2=(wantsVault||operation==='restore.start')&&selectedVault==='r2';
          const provider = useS3 ? await s3?.provider(profile)
            : useR2 ? await r2?.provider(profile)
            : wantsVault ? await vault?.provider(profile)
            : (operation === 'restore.start' && profile.dropbox?.refreshToken ? await vault?.provider(profile) : undefined);
          if (wantsVault && !provider) fail(useS3?'s3_connection_required':useR2?'r2_connection_required':'dropbox_connection_required');

          const selectedScope = operation === 'backup.start' && source ? await captureScope(source.api, sourceRef, input.scope) : null;
          data = await jobs.start({
            owner, sourceRef, targetRef,
            sourceToken: source?.token, targetToken: target?.token,
            passphrase: recoveryKey, provider, maxBytes: admission.maxBytes,
            operation: operation === 'backup.start' ? 'backup' : 'restore',
            capsuleId: input.capsuleId, dropboxCapsuleId: input.dropboxCapsuleId,
            scope: selectedScope?.capture, scopeSummary: selectedScope?.summary,
            allowOverwrite: input.allowOverwrite === true,
            authorize: () => admit({ authorization, operation, requestId: input.requestId }),
            refreshAccess: async () => {
              if (operation === 'backup.start' && source) return (await connections.access(profile, 'source')).token;
              if (operation === 'restore.start' && target) return (await connections.access(profile, 'target')).token;
              return null;
            },
          }); break;
        }
        case 'jobs.list': data={jobs:jobs.list(owner)}; break;
        case 'job.status': data=jobs.status(owner,input.id); break;
        default: fail('unsupported_operation');
      }
      return { ...data, sealedProfile:await sealProfile(profile,recoveryKey) };
    } finally { locks.delete(owner); }
  };
}
