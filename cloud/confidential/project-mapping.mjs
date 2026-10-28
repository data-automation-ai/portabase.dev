// Validate the complete restore plan before any capture or destination write.
export function validateProjectMapping({sourceRef,targetRef,sourceRefs,targetMap,mode,authorizedTargets}) {
  const sources=sourceRefs?.length ? sourceRefs : sourceRef ? [sourceRef] : [];
  if(new Set(sources).size!==sources.length)throw new Error('duplicate_source_project');
  if(mode==='capsule_only')return sources.map(source=>({source,target:null}));
  if(mode==='restore_only'){
    if(!targetRef)throw new Error('destination_mapping_required');
    if(authorizedTargets&&!authorizedTargets.includes(targetRef))throw new Error('destination_not_authorized');
    return [{source:null,target:targetRef}];
  }
  if(!sources.length)throw new Error('source_project_required');
  const targets=new Set();
  return sources.map(source=>{
    const target=sources.length>1 ? targetMap?.[source] : targetRef;
    if(!target)throw new Error('destination_mapping_required');
    if(authorizedTargets&&!authorizedTargets.includes(target))throw new Error('destination_not_authorized');
    if(sources.includes(target))throw new Error('destination_is_source_project');
    if(targets.has(target))throw new Error('duplicate_destination_project');
    targets.add(target);
    return {source,target};
  });
}
