import {createDefaultDatabaseScope} from '../runner/database-scope.mjs';

export function inventoryScope(status) {
  const inventory=status.inventory;
  if(!inventory || inventory.ref!==status.selection?.source)throw new Error('Source inventory is not loaded.');
  const db=createDefaultDatabaseScope(inventory.ref,'Selected source project')[0];
  const included=new Set(status.scope?.tables||inventory.tables.map(row=>row.name));
  db.tables=inventory.tables.map(row=>({name:row.name,schema:row.schema,objectName:row.table,
    objectType:'TABLE',sizeMb:row.bytes/1024**2,structureSizeMb:0,
    mode:included.has(row.name)?'structure_and_data':'structure_only'}));
  return [db];
}

export function scopeForm(status,databases,buckets,nonce) {
  const inventory=status.inventory,db=databases[0];
  if(databases.length!==1 || db?.projectRef!==inventory.ref || !db.enabled)
    throw new Error('Use the Source connection to select a project. This runner requires its database structure.');
  if(db.tables.length!==inventory.tables.length || new Set(db.tables.map(row=>row.name)).size!==inventory.tables.length
    || db.tables.some(row=>!inventory.tables.some(item=>item.name===row.name)))
    throw new Error('Only objects returned by the connected source can be applied.');
  if(db.tables.some(row=>!['structure_and_data','structure_only'].includes(row.mode)))
    throw new Error('This runner supports table data selection and structure-only. Excluding table definitions is not supported yet.');
  const form=new URLSearchParams({nonce});
  const dataNames=new Set(db.tables.filter(row=>row.mode==='structure_and_data').map(row=>row.name));
  inventory.tables.forEach((row,index)=>{if(dataNames.has(row.name))form.append('tableIndex',String(index));});
  inventory.buckets.forEach((row,index)=>{if(buckets.includes(row.id))form.append('bucketIndex',String(index));});
  if(status.scope?.auth!==false)form.set('auth','yes');
  if(status.scope?.functions!==false)form.set('functions','yes');
  return form;
}
