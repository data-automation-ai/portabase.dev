import test from 'node:test';
import assert from 'node:assert/strict';
import {dryRunSelection} from './dry-run-selection.mjs';

test('fixture remains the default only when no owner selection is set',()=>{
  const selected=dryRunSelection({});
  assert.equal(selected.synthetic,true);
  assert.equal(selected.refs.target,'jmqjsyyyhhwvkbqexxog');
});

test('owner drill requires two exact named, different projects',()=>{
  const env={PORTABASE_VALIDATION_SOURCE_REF:'a'.repeat(20),PORTABASE_VALIDATION_SOURCE_NAME:'Owner source',
    PORTABASE_VALIDATION_TARGET_REF:'b'.repeat(20),PORTABASE_VALIDATION_TARGET_NAME:'Blank restore target'};
  const selected=dryRunSelection(env);
  assert.equal(selected.synthetic,false);
  assert.deepEqual(selected.refs,{source:'a'.repeat(20),target:'b'.repeat(20)});
  assert.throws(()=>dryRunSelection({...env,PORTABASE_VALIDATION_TARGET_NAME:''}),/invalid_validation_selection/);
  assert.throws(()=>dryRunSelection({...env,PORTABASE_VALIDATION_TARGET_REF:'a'.repeat(20)}),/invalid_validation_selection/);
  assert.throws(()=>dryRunSelection({...env,PORTABASE_VALIDATION_TARGET_REF:'eoiqvdmvgaurlecdzqkp'}),/invalid_validation_selection/);
});
