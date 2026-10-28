import {computeDatabaseScopeSummary} from '../../cloud/runner/database-scope.mjs';

export const RECOVERY_SCREEN_VERSION = 'graphical-recovery-v2';
export function emptyRecoveryState() {
  return {version:RECOVERY_SCREEN_VERSION, mode:'dropbox', activeVault:'dropbox', allowOverwrite:false,
    selection:{source:'',target:'',sources:[],targetMap:{}}, projects:{source:[],target:[]},
    databases:[], inspections:{}, connections:{source:false,target:false,dropbox:false,googleDrive:false,s3:false},
    checkedAt:{}, accountConfirmation:null,vaultLocations:{}};
}
export function restoreRecoveryState(saved) {
  const base=emptyRecoveryState();
  if(!saved||saved.version!==RECOVERY_SCREEN_VERSION)return base;
  return {...base,...Object.fromEntries(Object.entries(saved).filter(([,value])=>value!==undefined)),
    selection:{...base.selection,...saved.selection,sources:Array.isArray(saved.selection?.sources)?saved.selection.sources:[],targetMap:saved.selection?.targetMap||{}},
    projects:{source:Array.isArray(saved.projects?.source)?saved.projects.source:[],target:Array.isArray(saved.projects?.target)?saved.projects.target:[]},
    connections:{...base.connections,...saved.connections},inspections:saved.inspections||{},checkedAt:saved.checkedAt||{},
    databases:Array.isArray(saved.databases)?saved.databases:[],vaultLocations:saved.vaultLocations||{}};
}

export function mergeDiscoveredDatabases(current, incoming) {
  const previous=new Map(current.map(db=>[db.projectRef,db]));
  return incoming.map(db=>{
    const old=previous.get(db.projectRef);
    if(!old)return {...db,databaseName:db.databaseName||'postgres'};
    const modes=rows=>new Map((rows||[]).map(row=>[`${row.objectType||''}:${row.name}`,row.mode]));
    const tables=modes(old.tables),binaries=modes(old.binaries);
    return {...db,databaseName:db.databaseName||'postgres',enabled:old.enabled,mode:old.mode,
      tables:(db.tables||[]).map(row=>({...row,mode:tables.get(`${row.objectType||''}:${row.name}`)||row.mode})),
      binaries:(db.binaries||[]).map(row=>({...row,mode:binaries.get(`${row.objectType||''}:${row.name}`)||row.mode}))};
  });
}

export function applyDiscovery(state, slot, data) {
  if(data.connected===false)return state; // A reconnect must not erase the last workspace.
  const projects=(data.projects||[]).map(p=>({...p,ref:p.ref||p.id}));
  const next={...state,projects:{...state.projects,[slot]:projects},
    connections:{...state.connections,[slot]:true},checkedAt:{...state.checkedAt,[slot]:new Date().toISOString()}};
  if(slot==='source')next.databases=mergeDiscoveredDatabases(state.databases,(data.databases||[]).map(db=>({...db,
    enabled:state.selection.sources.includes(db.projectRef)||db.projectRef===state.selection.source})));
  // Never silently select a different project when a grant changes.
  return next;
}

export function selectedDatabase(state) {
  return state.databases.find(db=>db.projectRef===state.selection.source);
}
export function recoveryScene(state) {
  const db=selectedDatabase(state);
  const bucketMap=new Map();
  for(const row of db?.binaries||[]) {
    const id=row.bucket||row.schema;
    const bucket=bucketMap.get(id)||{id,objects:0,bytes:0};
    bucket.objects++;bucket.bytes+=(row.sizeMb||0)*1024**2;bucketMap.set(id,bucket);
  }
  const inventory=db?{ref:db.projectRef,tables:(db.tables||[]).map(row=>({
    name:row.name,schema:row.schema,table:row.objectName,bytes:(row.sizeMb||0)*1024**2,rows:row.rows||0})),
    buckets:[...bucketMap.values()]}:null;
  const scope={tables:(db?.tables||[]).filter(row=>row.mode==='structure_and_data').map(row=>row.name),
    excludedTables:(db?.tables||[]).filter(row=>['skip','exclude'].includes(row.mode)).map(row=>row.name),
    buckets:[...new Set((db?.binaries||[]).filter(row=>!['skip','exclude'].includes(row.mode)).map(row=>row.bucket||row.schema))],auth:true,functions:true};
  const summary=computeDatabaseScopeSummary(db?[db]:[]);
  return {state:'select_projects',operatingMode:'production',...state,inventory,scope,
    selectedBytes:(summary.includedDatabaseMb+summary.includedBinaryMb)*1024**2,
    selectedDatabaseBytes:summary.includedDatabaseMb*1024**2,
    preflight:{ready:false,source:state.inspections?.source,target:state.inspections?.target},
    executing:false,accounts:{},hosted:true};
}

// Only UI choices and inventory enter this cache. Credentials never do.
export function recoveryCache(owner, storage=globalThis.localStorage, indexed=globalThis.indexedDB) {
  const key=`portabase.graphical-recovery.v2:${owner}`;
  const select=value=>({version:RECOVERY_SCREEN_VERSION,mode:value.mode,activeVault:value.activeVault,
    selection:value.selection,allowOverwrite:value.allowOverwrite,accountConfirmation:value.accountConfirmation,
    projects:value.projects,inspections:value.inspections,connections:value.connections,checkedAt:value.checkedAt,
    vaultLocations:value.vaultLocations});
  let database;
  async function open(){
    if(!indexed)return null;
    if(!database)database=new Promise((resolve,reject)=>{
      const req=indexed.open('portabase-recovery-workspaces',1);
      req.onupgradeneeded=()=>req.result.createObjectStore('workspaces');
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
    return database;
  }
  return {
    choices(){try{const value=JSON.parse(storage?.getItem(key)||'null');return value?.version===RECOVERY_SCREEN_VERSION?Object.fromEntries(Object.entries(select(value)).filter(([,v])=>v!==undefined)):{};}catch{return {};}},
    async read(){const db=await open();if(!db)return null;return new Promise((resolve,reject)=>{
      const req=db.transaction('workspaces').objectStore('workspaces').get(key);
      req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);
    });},
    async save(value){
      storage?.setItem(key,JSON.stringify(select(value)));
      const db=await open();if(!db)return;
      await new Promise((resolve,reject)=>{
        const tx=db.transaction('workspaces','readwrite');tx.objectStore('workspaces').put(value,key);
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
      });
    },
  };
}
