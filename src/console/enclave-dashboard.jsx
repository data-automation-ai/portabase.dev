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
  .hosted-vault-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
  .hosted-vault-head strong{color:#e6edf3;font-size:14px}
  .hosted-vault-off{background:#243247;color:#e6edf3;border:1px solid #52647d;border-radius:6px;padding:7px 13px;cursor:pointer}
  .hosted-vault-off[aria-pressed=true]{background:#0f766e;border-color:#2dd4bf}
  .hosted-vault-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin-top:10px}
  .hosted-vault-provider{display:flex;align-items:center;gap:9px;min-height:61px;padding:8px 10px;border:1px solid #49617b;border-radius:8px;background:#172338;color:#e6edf3;text-align:left;cursor:pointer}
  .hosted-vault-provider:hover:not(:disabled){border-color:#2dd4bf;background:#203550}
  .hosted-vault-provider:disabled{opacity:.62;cursor:not-allowed}
  .hosted-vault-provider svg{flex:none;width:34px;height:34px}
  .hosted-vault-provider span{display:grid;gap:2px;min-width:0}
  .hosted-vault-provider strong{font-size:12px;line-height:1.15}
  .hosted-vault-provider small{font-size:10px;color:#aab9cb;line-height:1.2}
  .hosted-vault-note{font-size:11px;color:#aab9cb;margin:9px 0 0}
  @media(max-width:700px){.recovery-scope-header{align-items:flex-start;flex-wrap:wrap}.recovery-scope-header h2{font-size:16px}.hosted-vault-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;

const vaultProviders=[
  {id:'dropbox',name:'Dropbox',route:'/oauth/dropbox/start',icon:'<svg viewBox="0 0 43 40" aria-hidden="true" fill="#0061ff"><path d="M12.5 0 0 8.2l8.8 7.1 12.5-7.7L12.5 0Zm18 0-8.8 7.6 12.5 7.7L43 8.2 30.5 0ZM0 22.4l12.5 8.2 8.8-7.4-12.5-7.7L0 22.4Zm42.6 0-12.5-7.7-12.5 7.7 8.8 7.4 16.2-7.4ZM21.3 25.1l-8.8 7.3-3.7-2.4v3.5l12.5 7.5 12.5-7.5v-3.5l-3.7 2.4-8.8-7.3Z"/></svg>'},
  {id:'google-drive',name:'Google Drive',route:'/oauth/google-drive/start',icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285f4" d="M8.2 3.8 2 14.5l3.8 6.5L12 10.3Z"/><path fill="#0f9d58" d="m15.8 3.8-6.2 10.7 3.8 6.5H21Z"/><path fill="#ffbb00" d="M8.2 3.8h7.6L22 14.5H9.8Z"/></svg>'},
  {id:'s3',name:'Amazon S3',icon:'<svg viewBox="0 0 40 40" aria-hidden="true"><path fill="#ff9900" d="M20 2 4 10v20l16 8 16-8V10L20 2Zm0 5 11 5.5L20 18 9 12.5 20 7Zm-12 9 10 5v11L8 27V16Zm24 11-10 5V21l10-5v11Z"/></svg>'},
  {id:'r2',name:'Cloudflare R2',icon:'<svg viewBox="0 0 40 40" aria-hidden="true" fill="#f38020"><path d="M9 28h22a7 7 0 0 0 .4-14 11.5 11.5 0 0 0-21.8 2.2A6 6 0 0 0 9 28Z"/><text x="20" y="25" text-anchor="middle" font-size="11" font-weight="bold" fill="#fff">R2</text></svg>'},
];
function hostedVaultMarkup(workspace){
  const off=workspace.mode==='temporary_runner';
  const cards=vaultProviders.map(provider=>{
    const connected=provider.id==='google-drive'?workspace.connections.googleDrive:workspace.connections[provider.id];
    const state=connected?'Connected':provider.route?'Connect account':'Setup pending';
    return `<button type="button" class="hosted-vault-provider" ${provider.route?`data-vault-connect="${provider.id}"`:'disabled title="Connection setup is not available yet"'} aria-label="${state}: ${provider.name}">${provider.icon}<span><strong>${provider.name}</strong><small>${state}</small></span></button>`;
  }).join('');
  return `<div class="hosted-vault-head"><strong>Backup destinations</strong><button type="button" class="hosted-vault-off" data-vault-off aria-pressed="${off}">Off · no capsule retained</button></div><div class="hosted-vault-grid">${cards}</div><p class="hosted-vault-note">Connect accounts independently. Delivery to multiple vaults is not available yet.</p>`;
}

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
          dropbox:Boolean(result.connectors?.dropbox?.oauthConnected),googleDrive:Boolean(result.connectors?.['google-drive']?.oauthConnected),s3:Boolean(result.connectors?.s3?.configured)}}));
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
    const vault=scene.querySelector('.enclave-vault-conduit + .internal-module');
    if(vault)vault.innerHTML=hostedVaultMarkup(workspace);
    const capsule=scene.querySelector('.capsule-branch section');
    if(capsule){
      const heading=capsule.querySelector('h2');if(heading)heading.textContent='Capsule delivery';
      const badges=capsule.querySelector('.vault-badges');if(badges)badges.textContent='No capsule delivery verified in this session.';
    }
    scene.querySelector('.recovery-mapping')?.remove();
    scene.querySelector('form[action="/mode"] input[type="hidden"][name="mode"]')?.form.closest('[role="status"]')?.remove();
    const cert=scene.querySelector('a[href="/attestation-certificate"]');
    if(cert){cert.removeAttribute('href');cert.removeAttribute('download');cert.textContent='Attestation pending';cert.setAttribute('aria-disabled','true');}
    scene.querySelectorAll('form[action="/select-batch"] select').forEach(select=>{
      const source=select.name.replace(/^targetFor_/,'');select.value=workspace.selection.targetMap?.[source]||'';
    });
    scene.querySelectorAll('form[action="/select"] select').forEach(select=>{const slot=select.form.querySelector('[name=slot]').value;select.value=workspace.selection[slot]||'';});
    const selected=scene.querySelector('.machine-selected');
    const summary=computeDatabaseScopeSummary(workspace.databases.filter(db=>workspace.selection.sources.includes(db.projectRef)||db.projectRef===workspace.selection.source));
    if(selected)selected.textContent=`${(summary.includedDatabaseMb+summary.includedBinaryMb).toFixed(2)} MB`;
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
      const off=event.target.closest?.('[data-vault-off]');if(off){setWorkspace(s=>({...s,mode:'temporary_runner'}));return;}
      const vault=event.target.closest?.('[data-vault-connect]');if(vault){
        const provider=vaultProviders.find(item=>item.id===vault.dataset.vaultConnect);
        if(provider?.route)window.open(provider.route,'portabase_vault_'+provider.id,'popup,width=700,height=800');
        return;
      }
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
