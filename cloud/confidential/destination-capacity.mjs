const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mb=value=>Number.isFinite(value)?`${(value/1024**2).toLocaleString('en-US',{maximumFractionDigits:2})} MB`:'Unknown';
export function destinationCapacityPanel(status) {
  const target=status.preflight?.target||status.inspections?.target;
  if(!target)return '<div class="dest-capacity-panel"><strong>Destination Capacity &amp; Auto-Growth:</strong> Select and check destination project to inspect disk limits.</div>';
  const cap=target.diskCapacity;
  const capacity=Number.isFinite(cap?.maxAllowedBytes)?cap.maxAllowedBytes:null;
  const database=Number.isFinite(target.databaseBytes)?target.databaseBytes:null;
  const free=capacity!==null&&database!==null?Math.max(0,capacity-database):null;
  const ag=cap?.autoGrowth;
  const sourceBytes=status.selectedDatabaseBytes??status.preflight?.source?.databaseBytes;
  const ceiling=ag?.enabled&&Number.isFinite(ag.maxSizeBytes)?ag.maxSizeBytes:capacity;
  const blocked=Number.isFinite(sourceBytes)&&Number.isFinite(ceiling)&&sourceBytes>ceiling;
  const settings=/^[a-z]{20}$/.test(target.ref||'')?`https://supabase.com/dashboard/project/${target.ref}/settings/compute-and-disk`:null;
  return `<div class="dest-capacity-panel${blocked?' warn':''}" data-destination-capacity style="margin:6px 0;padding:9px;border:1px solid #34435a;border-radius:6px;background:#0d131f;font-size:11px;line-height:1.6">
    <strong style="color:#38bdf8">Destination capacity</strong>
    <div>Current Max Allowed Space: <strong data-capacity-mb>${mb(capacity)}</strong>${cap?.diskType?` (${esc(cap.diskType.toUpperCase())})`:''}</div>
    <div>Database used: <strong data-used-mb>${mb(database)}</strong></div>
    <div>Estimated free: <strong data-free-mb>${mb(free)}</strong></div>
    <small>Free space is provisioned capacity minus logical database size. Filesystem overhead is additional. Storage buckets use a separate quota.</small>
    <div>Storage used: <strong>${mb(target.storageBytes)}</strong></div>
    <div>Auto-Growth: ${!ag?'Unknown — not returned by the provider':ag.enabled?`<strong style="color:#6ee7b7">Enabled</strong> · Increment: ${Number.isFinite(ag.growthPercent)?`+${esc(ag.growthPercent)}%`:''}${Number.isFinite(ag.minIncrementGb)?` / min +${esc(ag.minIncrementGb)} GB`:''} · Maximum: ${mb(ag.maxSizeBytes)}`:'<strong>Disabled</strong> (hard cap)'}</div>
    ${ag?.enabled?'<div class="autogrowth-spend-flash" role="alert"><strong>AUTO-GROWTH ENABLED — AUTO-GROWTH MAY INCREASE SPENDING</strong></div>':''}
    ${blocked?'<div role="alert">HARD BARRIER: Selected database exceeds the destination maximum allowed space.</div>':''}
    ${settings?`<a href="${settings}" target="_blank" rel="noreferrer" style="margin-top:7px;padding:5px 8px">Want to extend? Open destination disk settings ↗</a><small>Review capacity and pricing in Supabase before approving any increase.</small>`:''}
    <small>Checked: ${esc(target.checkedAt||'time unavailable')}</small>
  </div>`;
}
