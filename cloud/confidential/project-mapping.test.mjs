import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProjectMapping as validate} from './project-mapping.mjs';
import {executeDryRun} from './execute-dry-run.mjs';

test('overwrite permission never bypasses failed readiness checks',async()=>{
 for(const mode of ['temporary_runner','dropbox','capsule_only','restore_only']){
  const calls=[],status={};
  await executeDryRun({sourceRef:'a',targetRef:'x',mode,allowOverwrite:true,status,persist:async()=>{},command:async op=>{
   calls.push(op);return {ready:false,keyAcknowledged:false,source:{ref:'a'},target:{ref:'x',blank:false}};
  }});
  assert.equal(status.error,'unsafe_test_selection');assert.deepEqual(calls,['preflight']);
 }
});
test('each selected source requires its own authorized destination',()=>{
 const base={sourceRefs:['a','b'],targetRef:'fallback',mode:'temporary_runner',authorizedTargets:['x','y']};
 assert.throws(()=>validate({...base,targetMap:{a:'x'}}),/destination_mapping_required/);
 assert.throws(()=>validate({...base,targetMap:{a:'x',b:'x'}}),/duplicate_destination_project/);
 assert.throws(()=>validate({...base,targetMap:{a:'x',b:'z'}}),/destination_not_authorized/);
 assert.throws(()=>validate({...base,authorizedTargets:['a','x'],targetMap:{a:'x',b:'a'}}),/destination_is_source_project/);
 assert.deepEqual(validate({...base,targetMap:{a:'x',b:'y'}}),[{source:'a',target:'x'},{source:'b',target:'y'}]);
 assert.deepEqual(validate({sourceRef:'a',targetRef:'x'}),[{source:'a',target:'x'}]);
});
test('incomplete batch performs no cloud commands',async()=>{
 const calls=[],status={};
 await executeDryRun({sourceRefs:['a','b'],targetMap:{a:'x'},targetRef:'x',status,persist:async()=>{},command:async op=>calls.push(op)});
 assert.equal(status.error,'destination_mapping_required');assert.deepEqual(calls,[]);
});
test('bad second destination stops the entire batch before the first capture',async()=>{
 const calls=[],status={};let source='a',target='x';
 await executeDryRun({sourceRefs:['a','b'],sourceRef:'a',targetRef:'x',targetMap:{a:'x',b:'y'},status,persist:async()=>{},command:async(op,input)=>{
  calls.push(op);
  if(op==='project.select'){if(input.slot==='source')source=input.ref;else target=input.ref;return {};}
  if(op==='preflight')return {ready:target!=='y',source:{ref:source},target:{ref:target,blank:true}};
  throw new Error('unexpected_mutation');
 }});
 assert.equal(status.error,'unsafe_test_selection');assert.equal(calls.includes('backup.start'),false);assert.equal(calls.includes('restore.start'),false);
});
