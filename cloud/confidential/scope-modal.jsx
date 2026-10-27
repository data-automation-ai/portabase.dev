import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DatabaseScopeSelector} from '../../src/console/database-scope-selector.jsx';
import {computeDatabaseScopeSummary} from '../runner/database-scope.mjs';
import {inventoryScope,scopeForm} from './scope-ui-model.mjs';
import {startSafeRefresh} from './safe-page-refresh.mjs';

function ScopeModal(){
  const [status,setStatus]=useState(null),[databases,setDatabases]=useState([]);
  const [buckets,setBuckets]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const dialog=document.getElementById('advanced-object-dialog');
  async function open(){
    setError('');setBusy(true);dialog.showModal();
    try {
      const response=await fetch('/status',{cache:'no-store'});
      if(!response.ok)throw new Error('Cannot load source inventory.');
      const state=await response.json();
      setDatabases(inventoryScope(state));setStatus(state);
      setBuckets(state.scope?.buckets||state.inventory.buckets.map(row=>row.id));
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function apply(){
    setError('');setBusy(true);
    try {
      const nonce=document.querySelector('input[name="nonce"]').value;
      const body=scopeForm(status,databases,buckets,nonce);
      const response=await fetch('/scope',{method:'POST',body});
      if(!response.ok)throw new Error((await response.text()).replaceAll('_',' '));
      location.assign('/');
    }catch(e){setError(e.message);setBusy(false);}
  }
  const tableMb=computeDatabaseScopeSummary(databases).includedDatabaseMb||0;
  const bucketBytes=status?.inventory.buckets.filter(row=>buckets.includes(row.id)).reduce((n,row)=>n+row.bytes,0)||0;
  function handleDatabasesChange(nextDbs){
    setDatabases(nextDbs);
    const nextDb=nextDbs?.[0];
    if(nextDb&&Array.isArray(nextDb.binaries)){
      if(nextDb.enabled===false)setBuckets([]);
      else setBuckets(nextDb.binaries.filter(b=>b.mode!=='exclude'&&b.mode!=='skip').map(b=>b.bucket||b.schema));
    }
  }
  function handleBucketToggle(bucketId,checked){
    const nextBuckets=checked?[...new Set([...buckets,bucketId])]:buckets.filter(id=>id!==bucketId);
    setBuckets(nextBuckets);
    setDatabases(prev=>prev.map(db=>({...db,binaries:(db.binaries||[]).map(b=>(b.bucket||b.schema)===bucketId?{...b,mode:checked?'include':'exclude'}:b)})));
  }
  return <>
    <button type="button" onClick={open}>Select database objects</button>
    {dialog && createPortalContent()}
  </>;
  function createPortalContent(){
    return createPortal(<div className="advanced-scope">
      <header><h2>Database objects & capsule scope</h2><div style={{display:'flex',gap:'8px'}}><button type="button" onClick={apply} disabled={busy}>Save &amp; Close</button><button type="button" onClick={()=>dialog.close()} disabled={busy} style={{background:'#526c5e'}}>Cancel</button></div></header>
      <p>Original Portabase object selector. Table sizes are estimates; definition sizes are not measured.</p>
      {busy&&<p role="status">Working…</p>}
      {error&&<p role="alert" className="scope-error">{error}</p>}
      {status&&<>
        <DatabaseScopeSelector databases={databases} activeDbId={databases[0]?.id} onChange={handleDatabasesChange} readOnly={busy||status.executing===true}/>
        <h3>Storage buckets</h3><p>Bucket selection is connected. Individual Storage-object selection is not wired yet.</p>
        <div className="bucket-options">{status.inventory.buckets.map(row=><label key={row.id}>
          <input type="checkbox" checked={buckets.includes(row.id)} disabled={busy} onChange={e=>handleBucketToggle(row.id,e.target.checked)}/>
          {row.id} · {(row.bytes/1024**2).toFixed(2)} MiB · {row.objects} objects
        </label>)}</div>
        <footer><strong>Selected table data + Storage: {((tableMb+bucketBytes/1024**2)/1024).toFixed(3)} GiB</strong>
          <small>Auth, functions, definitions and packaging overhead are additional.</small>
          {error&&<p role="alert" className="scope-error">{error}</p>}
          <button type="button" disabled={busy} onClick={apply}>Save selection</button></footer>
      </>}
    </div>,dialog);
  }
}
import {createPortal} from 'react-dom';
const root=document.getElementById('advanced-object-control');
if(root)createRoot(root).render(<ScopeModal/>);
startSafeRefresh(document,window);
