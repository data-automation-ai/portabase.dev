import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryScope,scopeForm} from './scope-ui-model.mjs';
import {computeDatabaseScopeSummary} from '../runner/database-scope.mjs';
const status={selection:{source:'a'.repeat(20)},inventory:{ref:'a'.repeat(20),tables:[
  {name:'public.big',schema:'public',table:'big',bytes:104857600},
  {name:'public.small',schema:'public',table:'small',bytes:1048576}],buckets:[{id:'files',bytes:12}]},
  scope:{tables:['public.big'],buckets:['files'],auth:true,functions:false}};
test('original selector receives real inventory and sends structure-only as excluded row data',()=>{
  const dbs=inventoryScope(status);
  assert.equal(computeDatabaseScopeSummary(dbs).includedDatabaseMb,100);
  const form=scopeForm(status,dbs,['files'],'fixture');
  assert.deepEqual(form.getAll('tableIndex'),['0']);
  assert.deepEqual(form.getAll('bucketIndex'),['0']);
  assert.equal(form.get('auth'),'yes');assert.equal(form.has('functions'),false);
  assert.equal(form.get('databaseName'),'postgres');
  dbs[0].databaseName='another_database';
  assert.throws(()=>scopeForm(status,dbs,['files'],'fixture'),/only the postgres database/);
  dbs[0].databaseName='postgres';
  dbs[0].tables[0].mode='structure_only';
  assert.equal(scopeForm(status,dbs,[],'fixture').has('tableIndex'),false);
});
test('skip mode records excludedTableIndex and round-trips through inventoryScope while rejecting invented objects',()=>{
  const dbs=inventoryScope(status);
  dbs[0].tables[0].mode='skip';
  const form=scopeForm(status,dbs,[],'fixture');
  assert.deepEqual(form.getAll('tableIndex'),[]);
  assert.deepEqual(form.getAll('excludedTableIndex'),['0']);
  const reloaded=inventoryScope({...status,scope:{...status.scope,tables:[],excludedTables:['public.big']}});
  assert.equal(reloaded[0].tables[0].mode,'skip');
  assert.equal(reloaded[0].tables[1].mode,'structure_only');
  dbs[0].tables[0].mode='invalid_mode';
  assert.throws(()=>scopeForm(status,dbs,[],'fixture'),/table data selection/);
  dbs[0].tables[0].mode='structure_only';
  dbs[0].tables[0].name='private.invented';
  assert.throws(()=>scopeForm(status,dbs,[],'fixture'),/Only objects returned/);
});
