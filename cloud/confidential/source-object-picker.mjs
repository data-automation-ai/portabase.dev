// The confidential trial's version of the grouped object spreadsheet in
// cloud/runner/cloud-run-server.mjs. Its controls submit the attested runner's
// real /scope selections; they do not imply unsupported per-row restore modes.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const size=value=>!Number.isFinite(value)?'unknown':value>=1024**3?`${(value/1024**3).toFixed(2)} GiB`:value>=1024**2?`${(value/1024**2).toFixed(1)} MiB`:value>=1024?`${(value/1024).toFixed(1)} KiB`:`${value} B`;
const count=value=>Number(value||0).toLocaleString();

export const pickerCss=`
  .picker-head{display:flex;justify-content:space-between;gap:20px;align-items:start;flex-wrap:wrap}
  .picker-head h2{margin:0 0 6px}.picker-eyebrow{font:700 11px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#087b64}
  .picker-actions{display:flex;gap:8px;flex-wrap:wrap}.picker-actions button{padding:8px 11px;font-size:13px}
  .picker-project{background:#edf7f3;padding:16px;margin-top:16px;border:1px solid #b8d8cb;border-radius:7px}
  .picker-project form{display:flex;align-items:end;gap:10px;flex-wrap:wrap}.picker-project label{flex:1;min-width:240px;margin:0}
  .picker-project select{margin-bottom:0}.picker-project button{white-space:nowrap}
  .picker-summary{display:flex;gap:20px;flex-wrap:wrap;padding:12px 16px;margin:18px 0;background:#142b27;color:white;border-radius:6px}
  .picker-summary strong{color:#6be3b9}.picker-group{border:1px solid #cddfd6;margin:10px 0;border-radius:6px;overflow:hidden}
  .picker-database{border:2px solid #7fbba6;border-radius:7px;padding:10px;margin:18px 0}
  .picker-database>summary{font-weight:800;font-size:17px;cursor:pointer;padding:8px 4px}
  .picker-group summary{cursor:pointer;padding:13px 16px;background:#e9f3ef;font-weight:700;list-style:none}
  .picker-group summary::-webkit-details-marker{display:none}.picker-group summary:before{content:'▸';margin-right:9px;color:#087b64}
  .picker-group[open] summary:before{content:'▾'}.picker-group small{display:inline;margin:0 0 0 8px}
  .picker-scroll{overflow:auto;max-height:470px}.picker-table{width:100%;border-collapse:collapse;min-width:640px;font-size:13px}
  .picker-table th{text-align:left;color:#426258;background:#f4f8f6;position:sticky;top:0;z-index:1}
  .picker-table th,.picker-table td{padding:9px 12px;border-bottom:1px solid #e4eeea}
  .picker-table td:last-child,.picker-table th:last-child{text-align:right}.picker-table tr:hover td{background:#f3faf7}
  .picker-table input{width:17px;height:17px;accent-color:#087b64}.picker-check{white-space:nowrap;font-weight:600}
  .picker-foot{padding:9px 12px;background:#e0f2eb;text-align:right;font-weight:700}
  .picker-layer{display:flex;gap:24px;flex-wrap:wrap;padding:8px 0}.picker-layer label{margin:0}
  .picker-caveat{color:#92551e}.picker-apply{margin-top:15px}
`;

function projectChooser(projects,nonce,selected){
  const options=projects.map(p=>`<option value="${esc(p.ref)}"${p.ref===selected?' selected':''}>${esc(p.name)} (${esc(p.ref)})</option>`).join('');
  return `<div class="picker-project"><strong>Choose the Source project to inspect</strong><p>Inventory loads after you select a project. No table rows are read during this step.</p><form method="post" action="/select"><input type="hidden" name="nonce" value="${esc(nonce)}"><input type="hidden" name="slot" value="source"><label>Source Supabase project<select name="ref" required><option value="">Choose a project</option>${options}</select></label><button type="submit">Load database objects</button></form></div>`;
}

function group(title,rows,total,checked,render){
  return `<details class="picker-group" open><summary>${esc(title)} <small>${checked}/${rows.length} selected · ${size(total)}</small></summary><div class="picker-scroll"><table class="picker-table"><thead><tr><th>Include</th><th>Object</th><th>Type</th><th>Estimated contents</th><th>Size</th></tr></thead><tbody>${rows.map(render).join('')}</tbody></table></div><div class="picker-foot">Group total: ${size(total)}</div></details>`;
}

export function sourceObjectPicker({status,projects=[],nonce}){
  const ref=status.selection?.source,inventory=status.inventory;
  const header='<div class="picker-head"><div><span class="picker-eyebrow">2 · Source object picker</span><h2>Select Buckets, Tables &amp; Objects</h2><p>Expand a schema or bucket group to review the database objects before capture.</p></div></div>';
  if(!ref)return `<section class="scope" id="source-object-picker">${header}${status.connections?.source?projectChooser(projects,nonce):'<p>Connect Source Supabase above to inspect its projects and database objects.</p>'}</section>`;
  if(!inventory||inventory.ref!==ref)return `<section class="scope" id="source-object-picker">${header}${projectChooser(projects,nonce,ref)}<p>${status.error?esc(status.error):'Loading the selected source project’s objects.'}</p></section>`;
  const scope=status.scope||{tables:inventory.tables.map(row=>row.name),buckets:inventory.buckets.map(row=>row.id),auth:true,functions:true};
  const tableSet=new Set(scope.tables),bucketSet=new Set(scope.buckets),schemas=new Map();
  inventory.tables.forEach((row,index)=>{if(!schemas.has(row.schema))schemas.set(row.schema,[]);schemas.get(row.schema).push({row,index});});
  const selectedTableBytes=inventory.tables.filter(row=>tableSet.has(row.name)).reduce((sum,row)=>sum+(Number(row.bytes)||0),0);
  const selectedBucketBytes=inventory.buckets.filter(row=>bucketSet.has(row.id)).reduce((sum,row)=>sum+(Number(row.bytes)||0),0);
  const tableGroups=[...schemas].map(([schema,rows])=>group(`Database schema · ${schema}`,rows,rows.reduce((sum,{row})=>sum+(Number(row.bytes)||0),0),rows.filter(({row})=>tableSet.has(row.name)).length,({row,index})=>`<tr><td><input aria-label="Include ${esc(row.name)}" type="checkbox" name="tableIndex" value="${index}"${tableSet.has(row.name)?' checked':''}></td><td><strong>${esc(row.table)}</strong>${row.selectable?'':' <span class="picker-caveat">(full-table selection required)</span>'}</td><td>Postgres table</td><td>~${count(row.estimatedRows)} rows</td><td>${size(row.bytes)}</td></tr>`)).join('')||'<p>No application tables found.</p>';
  const buckets=inventory.buckets||[];
  const bucketGroup=buckets.length?group('Storage buckets',buckets,buckets.reduce((sum,row)=>sum+(Number(row.bytes)||0),0),buckets.filter(row=>bucketSet.has(row.id)).length,(row,index)=>`<tr><td><input aria-label="Include bucket ${esc(row.id)}" type="checkbox" name="bucketIndex" value="${index}"${bucketSet.has(row.id)?' checked':''}></td><td><strong>${esc(row.id)}</strong></td><td>Binary Storage</td><td>${count(row.objects)} objects</td><td>${size(row.bytes)}</td></tr>`):'<p>No Storage buckets found.</p>';
  const unsupported=inventory.tables.some(row=>!row.selectable);
  return `<section class="scope" id="source-object-picker">${header}${projectChooser(projects,nonce,ref)}<div class="picker-summary"><span>Database rows: <strong>${scope.tables.length}/${inventory.tables.length}</strong> · ${size(selectedTableBytes)}</span><span>Storage: <strong>${scope.buckets.length}/${buckets.length}</strong> · ${size(selectedBucketBytes)}</span></div><p>Database schemas and table definitions are always captured. Checkboxes control row data and Storage bytes.</p>${unsupported?'<p class="scope-note">Some names require full-table selection. Partial table selection is blocked when those names are present.</p>':''}<form method="post" action="/scope"><input type="hidden" name="nonce" value="${esc(nonce)}"><details class="picker-database" open><summary>PostgreSQL database · postgres</summary>${tableGroups}</details>${bucketGroup}<div class="picker-layer"><label><input type="checkbox" name="auth" value="yes"${scope.auth?' checked':''}> Auth users (${count(inventory.authUsers)})</label><label><input type="checkbox" name="functions" value="yes"${scope.functions?' checked':''}> Edge Functions (${count(inventory.functions)})</label></div><button type="submit" class="picker-apply">Apply source selection</button></form><small>Inventory contains object names and size estimates only. Table rows are read when capture runs.</small></section>`;
}
