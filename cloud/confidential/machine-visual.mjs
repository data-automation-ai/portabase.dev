const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function transferView(status) {
  const backup=status.backup,restore=status.restore;
  const failed=Boolean(status.error)||['drill_failed','paused'].includes(status.state);
  const running=job=>!failed&&status.executing===true&&job?.state==='running';
  const delivery=backup?.delivery;
  const known=Number.isSafeInteger(delivery?.bytesReceived)&&Number.isSafeInteger(delivery?.totalBytes)
    &&delivery.totalBytes>0&&delivery.bytesReceived>=0&&delivery.bytesReceived<=delivery.totalBytes;
  const verified=backup?.state==='complete'&&backup.result?.vaultVerified===true;
  return {
    sourceActive:running(backup)&&['database-manifest','database','storage','functions'].includes(backup.phase),
    targetActive:running(restore),vaultActive:running(backup)&&backup.phase==='transfer',
    percent:verified?100:known?Math.min(99,100*delivery.bytesReceived/delivery.totalBytes):null,
    label:verified?'Capsule delivered and verified':known?'Bytes received; verification pending':
      running(backup)&&backup.phase==='transfer'?'Uploading · byte count unavailable':'No measured capsule delivery yet',
  };
}
export function dataPipe(active,direction='right') {
  return `<div aria-label="${active?'Transfer active':'Transfer idle'}" class="data-pipe ${direction} ${active?'active':''}"><i></i><i></i><i></i></div>`;
}
export function capsuleJar(status) {
  const view=transferView(status);
  return `<div class="capsule-display"><div class="capsule-jar ${view.vaultActive?'active':''}" role="img" aria-label="${esc(view.label)}${view.percent===null?'':` · ${Math.floor(view.percent)} percent`}"><div class="capsule-water" style="height:${view.percent??0}%"></div><strong>${view.percent===null?'—':`${Math.floor(view.percent)}%`}</strong></div><p>${esc(view.label)}</p></div>`;
}
export const machineCss=`
.recovery-t{position:relative}.route{grid-template-columns:minmax(0,1fr) 38px minmax(0,1fr) 38px minmax(0,1fr);gap:0}
.data-pipe{position:relative;align-self:center;height:4px;background:#bbd5cd;overflow:hidden}
.data-pipe:after{content:'›';position:absolute;right:0;top:-12px;font-size:22px;color:#007b63}
.data-pipe i{display:none;position:absolute;width:10px;height:4px;background:#007b63;left:-10px}
.data-pipe.active i{display:block;animation:data-pulse 1.6s linear infinite}.data-pipe i:nth-child(2){animation-delay:.5s}.data-pipe i:nth-child(3){animation-delay:1s}
@keyframes data-pulse{to{left:100%}}
.capsule-branch{width:calc((100% - 76px)/3);min-width:270px;margin:0 auto}.capsule-branch>.data-pipe{width:4px;height:42px;margin:auto}
.data-pipe.down:after{display:none}.data-pipe.down i{width:4px;height:10px;left:0;top:-10px}.data-pipe.down.active i{animation-name:data-down}@keyframes data-down{to{top:100%}}
.capsule-branch section{margin-top:0}.capsule-display{text-align:center}.capsule-jar{position:relative;height:140px;width:100px;border:3px solid #457c70;border-top:8px solid #457c70;border-radius:10px 10px 24px 24px;overflow:hidden;margin:12px auto;background:#f5fcfa}
.capsule-water{position:absolute;bottom:0;left:0;width:100%;background:#62cebd;transition:height .5s}.capsule-water:before{content:'';position:absolute;left:-20%;top:-5px;width:140%;height:12px;border-radius:50%;background:#99e5d8}.capsule-jar.active .capsule-water:before{animation:water-wave 2s ease-in-out infinite alternate}@keyframes water-wave{to{transform:translateX(8%) rotate(3deg)}}
.capsule-jar strong{position:absolute;inset:58px 0 auto;color:#174a3e}.machine-selected{font-size:18px;font-weight:700}
#advanced-object-dialog{width:min(1250px,94vw);max-height:88vh;padding:0;border:1px solid #49665b;border-radius:10px;background:#0d1117;color:#f0f6fc}#advanced-object-dialog::backdrop{background:#0b211b99}
.advanced-scope{padding:22px}.advanced-scope header{display:flex;justify-content:space-between;align-items:center;gap:12px}.advanced-scope input[type=checkbox]{width:17px;height:17px}.advanced-scope footer{position:sticky;bottom:-22px;background:#0d1117;padding:16px 0;border-top:1px solid #30363d}.advanced-scope small{color:#adbcb6}.scope-error{padding:12px;background:#512623;color:#fff}.bucket-options{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px}.bucket-options label{margin:0;padding:8px;background:#161b22}
@media(max-width:820px){.route{grid-template-columns:1fr}.route>.data-pipe{height:24px;width:4px;justify-self:center}.capsule-branch{width:100%;min-width:0}.route>.data-pipe i{width:4px;height:10px;left:0;top:-10px;animation-name:data-down}.route>.data-pipe:after{display:none}}
@media(prefers-reduced-motion:reduce){.data-pipe.active i,.capsule-jar.active .capsule-water:before{animation:none}.data-pipe.active{background:#007b63}.capsule-water{transition:none}}
`;
