import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {renderDryRunPage} from '../../cloud/confidential/dry-run-gui.mjs';
import {DatabaseScopeSelector} from './database-scope-selector.jsx';
import {computeDatabaseScopeSummary} from '../../cloud/runner/database-scope.mjs';
import {authHeaders,loadSession} from '../lib/session.js';
import {ensureSessionForVersion,fetchStorageConnectors} from '../lib/cloud-api.js';
import {emptyRecoveryState,restoreRecoveryState,applyDiscovery,recoveryScene,recoveryCache,RECOVERY_SCREEN_VERSION} from './graphical-recovery-state.mjs';
import consoleCss from './console.css?inline';

const oauthLink=slot=>`/oauth/supabase/start?slot=${slot}`;
const modalCss=`
  :host{display:block;min-width:0;color:#0f172a;font-family:system-ui,sans-serif;--pb-text:#e6edf3;--pb-muted:#8b949e;--text-main:#e6edf3;--text-muted:#94a3b8;--bg-elevated:#111824;--border-subtle:#34435a;--accent-green:#34d399;--accent-cyan:#38bdf8}
  .recovery-scope-dialog{box-sizing:border-box;width:min(1450px,96vw);max-width:96vw;max-height:92vh;padding:0;border:1px solid #34435a;border-radius:10px;background:#0d1117;color:#e6edf3}
  .recovery-scope-dialog::backdrop{background:#020617a8}
  .recovery-scope-header{position:sticky;top:0;z-index:10;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 18px;background:#111824;border-bottom:1px solid #34435a}
  .recovery-scope-header h2{margin:0;color:#e6edf3}.recovery-scope-body{padding:16px;overflow:auto}
  .recovery-scope-dialog button{cursor:pointer}.recovery-scope-dialog .pb-btn{color:#e6edf3;background:#1c293a;border:1px solid #40516a;border-radius:5px;padding:7px 12px}
  .recovery-scope-dialog .pb-btn-primary{background:#0f766e;border-color:#10b981}
  .recovery-scope-footer{display:flex;gap:12px;align-items:center;justify-content:space-between;position:sticky;bottom:0;padding:12px 18px;background:#111824;border-top:1px solid #34435a}
  .recovery-scope-dialog input[type=text],.recovery-scope-dialog input[type=number]{box-sizing:border-box;color:#e6edf3;background:#0d131f;border:1px solid #40516a;border-radius:4px;padding:7px}
  .recovery-scope-dialog .pb-scope-selector{color:#e6edf3}
  @media(max-width:700px){.recovery-scope-header{align-items:flex-start;flex-wrap:wrap}.recovery-scope-header h2{font-size:16px}}
`;

export function EnclaveDashboard({me,toast,fixtureApi}) {
  const owner=me?.user?.id||loadSession()?.user?.id||'signed-out';
  const cache=useMemo(()=>recoveryCache(owner),[owner]);
  const [workspace,setWorkspace]=useState(()=>restoreRecoveryState(cache.choices()));
  const stateRef=useRef(workspace);stateRef.current=workspace;
  const [loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [pickerOpen,setPickerOpen]=useState(false),[draft,setDraft]=useState([]),[saveState,setSaveState]=useState('');
  const hostRef=useRef(null),shadowRef=useRef(null),sceneRef=useRef(null),dialogRef=useRef(null);
  const [mount,setMount]=useState(null),alive=useRef(true),refreshing=useRef(false);

  useEffect(()=>{
    alive.current=true;let cancelled=false;
    cache.read().then(saved=>{if(!cancelled&&saved?.version===RECOVERY_SCREEN_VERSION)setWorkspace(restoreRecoveryState({...saved,...cache.choices()}));})
      .catch(()=>{}).finally(()=>{if(!cancelled)setLoaded(true);});
    return()=>{cancelled=true;alive.current=false;};
  },[cache]);
  useEffect(()=>{
    if(!loaded)return;
    cache.save(workspace).then(()=>setSaveState('Saved on this browser')).catch(()=>setSaveState('Browser storage unavailable — keep this tab open'));
  },[cache,workspace,loaded]);

  async function request(action,slot,project){
    if(fixtureApi)return fixtureApi(action,slot,project);
    await ensureSessionForVersion('supabase');
    const query=new URLSearchParams({provider:'supabase',action,slot,...(project?{project}:{})});
    const response=await fetch('/api/cloud/oauth?'+query,{headers:authHeaders(loadSession()),cache:'no-store',signal:AbortSignal.timeout(65000)});
    const data=await response.json();
    if(!response.ok||data.ok===false)throw Error(response.status===401?'Your connection needs renewal. Your projects and object selections are preserved.':data.error||'The connection could not be refreshed. Your selections are preserved.');
    return data;
  }
  async function refresh(){
    if(refreshing.current)return;refreshing.current=true;setBusy(true);setError('');
    const failures=[];
    try{
      await Promise.all(['source','target'].map(async slot=>{
        try{
          const data=await request('discover',slot,stateRef.current.selection[slot]);
          if(!alive.current)return;
          if(data.connected===false){if(stateRef.current.connections[slot])failures.push(`${slot==='target'?'Destination':'Source'} needs OAuth renewal. Last-known readings and selections are retained.`);return;}
          setWorkspace(current=>applyDiscovery(current,slot,data));
        }catch(e){failures.push(e.message);}
      }));
      if(!fixtureApi){try{
        const result=await fetchStorageConnectors('supabase');
        if(alive.current)setWorkspace(s=>({...s,connections:{...s.connections,
          dropbox:Boolean(result.connectors?.dropbox?.oauthConnected),s3:Boolean(result.connectors?.s3?.configured)}}));
      }catch{ /* Keep the last confirmed connector status during a failed refresh. */ }}
      for(const slot of ['source','target']){
        const ref=stateRef.current.selection[slot];if(!ref)continue;
        try{const data=await request('inspect',slot,ref);if(data.inspection&&alive.current)setWorkspace(s=>({...s,inspections:{...s.inspections,[slot]:data.inspection}}));}
        catch(e){failures.push(`${slot==='target'?'Destination':'Source'} inspection unavailable. ${e.message}`);}
      }
    }finally{refreshing.current=false;if(alive.current){setBusy(false);setError([...new Set(failures)].join(' '));}}
  }
  useEffect(()=>{if(loaded)refresh();},[loaded]);
  useEffect(()=>{
    const update=()=>refresh();
    const message=event=>{if(event.origin===location.origin&&event.data?.type==='portabase_oauth_complete')refresh();};
    window.addEventListener('focus',update);window.addEventListener('online',update);window.addEventListener('message',message);
    return()=>{window.removeEventListener('focus',update);window.removeEventListener('online',update);window.removeEventListener('message',message);};
  },[]);

  useEffect(()=>{
    const root=hostRef.current.shadowRoot||hostRef.current.attachShadow({mode:'open'});shadowRef.current=root;
    const baseStyle=document.createElement('style');baseStyle.textContent=consoleCss+'\n'+modalCss;root.appendChild(baseStyle);
    const sceneStyle=document.createElement('style');root.appendChild(sceneStyle);
    const scene=document.createElement('div');scene.className='graphical-scene';root.appendChild(scene);sceneRef.current={scene,style:sceneStyle};
    const portal=document.createElement('div');root.appendChild(portal);setMount(portal);
    return()=>{root.replaceChildren();};
  },[]);

  useEffect(()=>{
    if(!sceneRef.current)return;
    const sceneStatus=recoveryScene(workspace);
    const html=renderDryRunPage({status:sceneStatus,selection:workspace.selection,projects:workspace.projects,
      links:{source:oauthLink('source'),target:oauthLink('target'),dropbox:'/oauth/dropbox/start'},nonce:'hosted-ui'});
    const css=html.match(/<style>([\s\S]*?)<\/style>/i)?.[1]||'';
    const markup=html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1]||'';
    sceneRef.current.style.textContent=css.replace(/\bbody\s*\{/g,'.graphical-scene{')+'\n.graphical-scene section,.graphical-scene section h2{color:#e6edf3}.graphical-scene section div,.graphical-scene section p,.graphical-scene section label{color:inherit}.graphical-scene .machine-progress,.graphical-scene .recovery-mapping{color:#cbd5e1}.graphical-scene>.account-confirmation{padding:7px 10px;border:1px solid #b45309;border-radius:6px;margin:6px 0;font-size:12px}.account-confirmation>summary{cursor:pointer;color:#92400e;font-weight:600}';
    const scene=sceneRef.current.scene;
    scene.innerHTML=markup.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
    scene.querySelector('#advanced-object-dialog')?.remove();
    const control=scene.querySelector('#advanced-object-control');
    if(control)control.innerHTML=`<button type="button" data-open-scope${loaded?'':' disabled'}>${loaded?'Select database objects':'Loading saved objects…'}</button>`;
    const accountSection=scene.querySelector('form[action="/confirm-accounts"]')?.closest('section');
    if(accountSection){const details=document.createElement('details');details.className='account-confirmation';const summary=document.createElement('summary');summary.textContent='Confirm separate Supabase accounts before running recovery';details.appendChild(summary);accountSection.replaceWith(details);details.appendChild(accountSection);}
    for(const form of scene.querySelectorAll('form[action="/supabase-token"]'))form.closest('details')?.remove();
    scene.querySelector('form[action="/callback"]')?.closest('section')?.remove();
    const cert=scene.querySelector('a[href="/attestation-certificate"]');
    if(cert){cert.removeAttribute('href');cert.removeAttribute('download');cert.textContent='Attestation pending';cert.setAttribute('aria-disabled','true');}
    scene.querySelectorAll('form[action="/select-batch"] select').forEach(select=>{
      const source=select.name.replace(/^targetFor_/,'');select.value=workspace.selection.targetMap?.[source]||'';
    });
    scene.querySelectorAll('form[action="/select"] select').forEach(select=>{const slot=select.form.querySelector('[name=slot]').value;select.value=workspace.selection[slot]||'';});
    const selected=scene.querySelector('.machine-selected');
    const summary=computeDatabaseScopeSummary(workspace.databases.filter(db=>workspace.selection.sources.includes(db.projectRef)||db.projectRef===workspace.selection.source));
    if(selected)selected.textContent=`${(summary.includedDatabaseMb+summary.includedBinaryMb).toFixed(2)} MB`;
    const recheck=scene.querySelector('form[action="/mode"] input[type="hidden"][name="mode"]')?.form;
    if(recheck&&workspace.inspections.source&&workspace.inspections.target){
      const p=recheck.previousElementSibling;if(p)p.textContent='Source and destination inspections are loaded. Object selection and destination capacity are shown above.';
    }
  },[workspace,mount,loaded]);

  function openPicker(){flushSync(()=>{setDraft(structuredClone(stateRef.current.databases));setPickerOpen(true);});dialogRef.current?.showModal();}
  async function savePicker(){
    const sources=draft.filter(db=>db.enabled!==false&&db.mode!=='skip').map(db=>db.projectRef);
    const next={...stateRef.current,databases:draft,selection:{...stateRef.current.selection,sources,source:sources.includes(stateRef.current.selection.source)?stateRef.current.selection.source:sources[0]||''}};
    setWorkspace(next);await cache.save(next).catch(()=>setSaveState('Browser storage unavailable — keep this tab open'));
    dialogRef.current?.close();setPickerOpen(false);toast?.('Object selection saved','ok');
  }
  async function checkProject(slot,ref,allowOverwrite){
    if(!ref)return;
    setWorkspace(s=>({...s,allowOverwrite:slot==='target'?allowOverwrite:s.allowOverwrite,
      selection:{...s.selection,[slot]:ref,...(slot==='source'?{sources:[ref]}:{})},
      databases:slot==='source'?s.databases.map(db=>({...db,enabled:db.projectRef===ref})):s.databases,
      inspections:{...s.inspections,[slot]:undefined}}));
    setBusy(true);setError('');
    try{
      if(slot==='source'){
        const discovered=await request('discover',slot,ref);if(discovered.connected!==false)setWorkspace(s=>applyDiscovery(s,slot,discovered));
      }
      const result=await request('inspect',slot,ref);
      if(!result.inspection)throw Error('Authorize this connection before checking its capacity.');
      setWorkspace(s=>s.selection[slot]===ref?{...s,inspections:{...s.inspections,[slot]:result.inspection}}:s);
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }

  useEffect(()=>{
    const root=shadowRef.current;if(!root)return;
    const click=event=>{
      const button=event.target.closest?.('[data-open-scope]');if(button){openPicker();return;}
      const copy=event.target.closest?.('[data-copy-url]');if(copy){navigator.clipboard.writeText(new URL(copy.dataset.copyUrl,location.origin).href).then(()=>toast?.('Authorization link copied','ok')).catch(()=>setError('The browser could not copy the link.'));return;}
      const link=event.target.closest?.('a[data-oauth-popup]');
      if(link){const popup=window.open(link.href,'portabase_oauth_'+(link.href.includes('target')?'target':'source'),'popup,width=700,height=800');if(popup)event.preventDefault();}
    };
    const change=event=>{
      const target=event.target,form=target.form;if(!form||!sceneRef.current.scene.contains(form))return;
      if(form.getAttribute('action')==='/mode')setWorkspace(s=>({...s,mode:target.value}));
    };
    const submit=event=>{
      const form=event.target;if(!sceneRef.current.scene.contains(form))return;event.preventDefault();
      const action=form.getAttribute('action'),data=new FormData(form);
      if(action==='/select')checkProject(String(data.get('slot')),String(data.get('ref')||''),data.get('allowOverwrite')==='yes');
      else if(action==='/reauthorize')window.open(oauthLink(data.get('slot')),'portabase_oauth_'+data.get('slot'),'popup,width=700,height=800');
      else if(action==='/vault-provider')setWorkspace(s=>({...s,activeVault:String(data.get('provider'))}));
      else if(action==='/mode'){if(data.get('mode'))setWorkspace(s=>({...s,mode:String(data.get('mode'))}));refresh();}
      else if(action==='/confirm-accounts')setWorkspace(s=>({...s,accountConfirmation:{confirmed:true,method:'operator',sourceEmail:String(data.get('sourceEmail')||''),targetEmail:String(data.get('targetEmail')||'')}}));
      else if(action==='/select-batch'){
        const sources=data.getAll('sourceRefs').length?data.getAll('sourceRefs'):data.getAll('sources');
        const targetMap=Object.fromEntries(sources.map(ref=>[ref,data.get('targetFor_'+ref)||'']));
        const destinations=Object.values(targetMap);
        if(stateRef.current.mode!=='capsule_only'&&(destinations.some(ref=>!ref)||new Set(destinations).size!==destinations.length||sources.some(ref=>ref===targetMap[ref]))){setError('Choose a separate destination for each source project.');return;}
        setWorkspace(s=>({...s,selection:{...s.selection,sources,source:sources[0]||'',targetMap}}));
      }else if(action==='/dropbox')window.open('/oauth/dropbox/start','portabase_dropbox','popup,width=700,height=800');
      else if(action==='/s3')setError('Open Connections & Vaults to configure your S3 vault. Your object selection is saved.');
    };
    root.addEventListener('click',click);root.addEventListener('change',change);root.addEventListener('submit',submit);
    return()=>{root.removeEventListener('click',click);root.removeEventListener('change',change);root.removeEventListener('submit',submit);};
  },[mount,workspace.databases]);

  const draftSummary=computeDatabaseScopeSummary(draft),total=draftSummary.includedDatabaseMb+draftSummary.includedBinaryMb;
  return <div data-recovery-screen={RECOVERY_SCREEN_VERSION} style={{width:'100%',minWidth:0,background:'#fff',borderRadius:8}}>
    <div style={{display:'flex',padding:'10px 16px',gap:12,alignItems:'center',flexWrap:'wrap',color:'#334155',fontSize:12}}>
      <button className="pb-btn pb-btn-primary" type="button" onClick={refresh} disabled={busy||!loaded}>{busy?'Refreshing connections…':'Refresh connections'}</button>
      <span role="status">{saveState||'Loading saved workspace…'}</span><span>Source → Secure runner → Destination</span>
    </div>
    {error&&<div role="alert" style={{margin:'4px 16px',padding:12,background:'#fff7ed',border:'1px solid #b45309',borderRadius:6,color:'#7c2d12'}}>{error} <button type="button" onClick={refresh}>Retry connection</button></div>}
    <div ref={hostRef}/>
    {mount&&createPortal(<dialog className="recovery-scope-dialog" ref={dialogRef} aria-label="Database objects and Storage scope" onCancel={()=>setPickerOpen(false)}>
      <header className="recovery-scope-header"><h2>Database objects &amp; Storage scope</h2><div style={{display:'flex',gap:8}}>
        <button className="pb-btn pb-btn-primary" onClick={savePicker}>Save &amp; Close</button>
        <button className="pb-btn" onClick={()=>{dialogRef.current.close();setPickerOpen(false);}}>Cancel</button></div></header>
      <div className="recovery-scope-body"><p>Select projects, schemas, tables and individual Storage files. Your choices remain attached to this recovery screen.</p>
        {draft.length?<DatabaseScopeSelector key={pickerOpen?'open':'closed'} databases={draft} activeDbId={draft.find(db=>db.projectRef===workspace.selection.source)?.id} onChange={setDraft} allowAddDatabase={false} allowAddTable={false}/>
          :<p>Authorize the source connection, then refresh to load its database objects.</p>}
      </div>
      <footer className="recovery-scope-footer"><strong>Selected data + Storage: {total.toFixed(2)} MB</strong><button className="pb-btn pb-btn-primary" onClick={savePicker}>Save selection</button></footer>
    </dialog>,mount)}
  </div>;
}
