import {createDefaultDatabaseScope} from '../runner/database-scope.mjs';

export function inventoryScope(status) {
  const inventory=status.inventory;
  if(!inventory || inventory.ref!==status.selection?.source)throw new Error('Source inventory is not loaded.');
  const db=createDefaultDatabaseScope(inventory.ref,status.inspections?.source?.name||status.preflight?.source?.name||'Selected source project')[0];
  const included=new Set(status.scope?.tables||inventory.tables.map(row=>row.name));
  const excluded=new Set(status.scope?.excludedTables||[]);
  const includedBuckets=new Set(status.scope?.buckets||(inventory.buckets||[]).map(row=>row.id));
  db.tables=inventory.tables.map(row=>({name:row.name,schema:row.schema,objectName:row.table,
    objectType:'TABLE',sizeMb:row.bytes/1024**2,structureSizeMb:0,
    mode:excluded.has(row.name)?'skip':included.has(row.name)?'structure_and_data':'structure_only'}));
  db.binaries=(inventory.buckets||[]).map(row=>({
    name:`${row.id}/${row.objects||0}_objects`,bucket:row.id,schema:row.id,
    objectName:`${row.objects||0} objects`,objectType:'BINARY',sizeMb:(row.bytes||0)/1024**2,
    mode:includedBuckets.has(row.id)?'include':'exclude'}));
  const allTablesSkipped=db.tables.length>0&&db.tables.every(t=>t.mode==='skip');
  const allBucketsSkipped=db.binaries.every(b=>b.mode==='exclude');
  db.enabled=!(allTablesSkipped&&allBucketsSkipped);
  db.mode=db.tables.some(t=>t.mode==='structure_and_data')?'structure_and_data'
    :db.tables.some(t=>t.mode==='structure_only')?'structure_only':'skip';
  return [db];
}

export function scopeForm(status,databases,buckets,nonce) {
  const inventory=status.inventory,db=databases[0];
  if(databases.length!==1 || db?.projectRef!==inventory.ref)
    throw new Error('Use the Source connection to select a project. This runner requires its database structure.');
  if(db.databaseName!=='postgres')throw new Error('This Supabase runner currently supports only the postgres database.');
  if(db.tables.length!==inventory.tables.length || new Set(db.tables.map(row=>row.name)).size!==inventory.tables.length
    || db.tables.some(row=>!inventory.tables.some(item=>item.name===row.name)))
    throw new Error('Only objects returned by the connected source can be applied.');
  if(db.tables.some(row=>!['structure_and_data','structure_only','skip','exclude'].includes(row.mode)))
    throw new Error('This runner supports table data selection, structure-only, and excluding tables.');
  const form=new URLSearchParams({nonce,databaseName:db.databaseName});
  const enabled=db.enabled!==false;
  const dataNames=new Set(enabled?db.tables.filter(row=>row.mode==='structure_and_data').map(row=>row.name):[]);
  const skipNames=new Set(enabled?db.tables.filter(row=>row.mode==='skip'||row.mode==='exclude').map(row=>row.name):inventory.tables.map(row=>row.name));
  inventory.tables.forEach((row,index)=>{
    if(dataNames.has(row.name))form.append('tableIndex',String(index));
    if(skipNames.has(row.name))form.append('excludedTableIndex',String(index));
  });
  const binaryExcluded=new Set(Array.isArray(db.binaries)?db.binaries.filter(b=>b.mode==='exclude'||b.mode==='skip').map(b=>b.bucket||b.schema):[]);
  inventory.buckets.forEach((row,index)=>{
    if(enabled&&buckets.includes(row.id)&&!binaryExcluded.has(row.id))form.append('bucketIndex',String(index));
  });
  if(status.scope?.auth!==false)form.set('auth','yes');
  if(status.scope?.functions!==false)form.set('functions','yes');
  return form;
}
