// Avoid discarding a selection or a partially entered authorization code.
export function startSafeRefresh(document, window) {
  if (window.location?.search?.includes('oauth_complete=') && window.opener) {
    try {
      window.opener.postMessage({ type: 'portabase_oauth_complete' }, '*');
      window.close();
    } catch {}
    window.history?.replaceState?.(null, '', '/');
  }

  window.addEventListener?.('message', e => {
    if (e?.data?.type === 'portabase_oauth_complete') window.location.reload();
  });

  document.addEventListener?.('click', e => {
    const link = e.target?.closest?.('a[data-oauth-popup="true"]');
    if (!link || !window.open) return;
    const popup = window.open(link.href, 'portabase_oauth', 'popup,width=640,height=760');
    if (popup) e.preventDefault();
  });

  const delay=Number(document.body?.dataset?.refreshMs);
  document.addEventListener?.('change',event=>{
    const target=event.target;
    if(target?.form?.getAttribute?.('action')==='/select'&&delay!==5000){
      const refVal=target.name==='ref'?target.value:target.form.querySelector?.('select[name="ref"]')?.value;
      if(refVal)target.form.submit?.();
    }
  });
  if(!Number.isFinite(delay)||delay<=0)return;
  let edited=false;
  const rememberEdit=event=>{
    if(delay!==5000&&event.target?.matches?.('input, select, textarea'))edited=true;
  };
  document.addEventListener?.('input',rememberEdit);
  document.addEventListener?.('change',rememberEdit);
  const refresh=()=>{
    if(document.querySelector?.('dialog[open]')||(delay!==5000&&(edited||document.activeElement?.matches?.('input, select, textarea')))){
      window.setTimeout(refresh,1000);
      return;
    }
    window.location.reload();
  };
  window.setTimeout(refresh,delay);
}
