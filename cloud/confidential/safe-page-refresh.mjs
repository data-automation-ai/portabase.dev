// Avoid discarding a selection or a partially entered authorization code.
export function startSafeRefresh(document, window) {
  const delay=Number(document.body.dataset.refreshMs);
  if(!Number.isFinite(delay)||delay<=0)return;
  let edited=false;
  const rememberEdit=event=>{
    if(event.target.matches('input, select, textarea'))edited=true;
  };
  document.addEventListener('input',rememberEdit);
  document.addEventListener('change',rememberEdit);
  const refresh=()=>{
    if(edited||document.querySelector('dialog[open]')||document.activeElement?.matches('input, select, textarea')){
      window.setTimeout(refresh,1000);
      return;
    }
    window.location.reload();
  };
  window.setTimeout(refresh,delay);
}
