import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DatabaseScopeSelector} from '../../src/console/database-scope-selector.jsx';
import {computeDatabaseScopeSummary} from '../runner/database-scope.mjs';
import {inventoryScope,scopeForm} from './scope-ui-model.mjs';

function ScopeModal(){
  const [status,setStatus]=useState(null),[databases,setDatabases]=useState([]);
  const [buckets,setBuckets]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const dialog=document.getElementById('advanced-object-dialog');
  async function open(){
    document.querySelector('meta[http-equiv="refresh"]')?.remove();
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
  return <>
    <button type="button" onClick={open}>Select database objects</button>
    {dialog && createPortalContent()}
  </>;
  function createPortalContent(){
    return createPortal(<div className="advanced-scope">
      <header><h2>Database objects & capsule scope</h2><button onClick={()=>dialog.close()} disabled={busy}>Close</button></header>
      <p>Original Portabase object selector. Table sizes are estimates; definition sizes are not measured.</p>
      {busy&&<p role="status">Working…</p>}
      {error&&<p role="alert" className="scope-error">{error}</p>}
      {status&&<>
        <DatabaseScopeSelector databases={databases} activeDbId={databases[0]?.id} onChange={setDatabases} readOnly={busy||status.executing===true}/>
        <h3>Storage buckets</h3><p>Bucket selection is connected. Individual Storage-object selection is not wired yet.</p>
        <div className="bucket-options">{status.inventory.buckets.map(row=><label key={row.id}>
          <input type="checkbox" checked={buckets.includes(row.id)} disabled={busy} onChange={e=>setBuckets(e.target.checked?[...buckets,row.id]:buckets.filter(id=>id!==row.id))}/>
          {row.id} · {(row.bytes/1024**2).toFixed(2)} MiB · {row.objects} objects
        </label>)}</div>
        <footer><strong>Selected table data + Storage: {((tableMb+bucketBytes/1024**2)/1024).toFixed(3)} GiB</strong>
          <small>Auth, functions, definitions and packaging overhead are additional.</small>
          <button disabled={busy} onClick={apply}>Apply selection</button></footer>
      </>}
    </div>,dialog);
  }
}
import {createPortal} from 'react-dom';
const root=document.getElementById('advanced-object-control');
if(root)createRoot(root).render(<ScopeModal/>);
