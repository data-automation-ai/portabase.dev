import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyRecoveryState,restoreRecoveryState,applyDiscovery,recoveryCache,recoveryScene,RECOVERY_SCREEN_VERSION} from '../src/console/graphical-recovery-state.mjs';
import {destinationCapacityPanel} from '../cloud/confidential/destination-capacity.mjs';
import {readFile} from 'node:fs/promises';
const fixture={connected:true,projects:[{id:'a',name:'Source'}],databases:[{id:'db_a',projectRef:'a',databaseName:'postgres',enabled:true,mode:'structure_and_data',estimatedSizeMb:3,
  tables:[{name:'public.accounts',schema:'public',objectType:'TABLE',mode:'structure_and_data',sizeMb:1},{name:'public.orders',schema:'public',objectType:'TABLE',mode:'structure_and_data',sizeMb:2}],
  binaries:[{name:'images/alpha.png',bucket:'images',objectType:'BINARY',mode:'include',sizeMb:1}]}]};

test('refresh preserves independent table/file choices, project mapping and destination reading',()=>{
  let state=emptyRecoveryState();state.selection={source:'a',target:'b',sources:['a'],targetMap:{a:'b'}};
  state=applyDiscovery(state,'source',fixture);
  state.databases[0].tables[0].mode='structure_only';state.databases[0].binaries[0].mode='exclude';
  state.inspections.target={ref:'b',databaseBytes:1048576};
  const refreshed=applyDiscovery(state,'source',structuredClone(fixture));
  assert.equal(refreshed.databases[0].tables[0].mode,'structure_only');
  assert.equal(refreshed.databases[0].binaries[0].mode,'exclude');
  assert.deepEqual(refreshed.selection,state.selection);assert.deepEqual(refreshed.inspections,state.inspections);
  assert.equal(applyDiscovery(refreshed,'source',{connected:false}),refreshed);
  assert.equal(recoveryScene(refreshed).scope.excludedTables.length,0);
});
test('workspace choices are isolated by signed-in owner and never persist auth tokens',async()=>{
  const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
  const a=recoveryCache('owner-a',storage,null),b=recoveryCache('owner-b',storage,null);
  const value={...emptyRecoveryState(),selection:{source:'selected',target:'destination'},accessToken:'must-not-persist'};
  await a.save(value);assert.equal(a.choices().selection.source,'selected');assert.deepEqual(b.choices(),{});
  assert.doesNotMatch([...values.values()].join(''),/must-not-persist|accessToken/);
});
test('destination reports MB used/free separately from Storage and preserves unknown provider limits',()=>{
  const panel=destinationCapacityPanel({inspections:{target:{ref:'a'.repeat(20),databaseBytes:1024**3,storageBytes:10*1024**3,diskCapacity:{sizeGb:8,maxAllowedBytes:8*1024**3,autoGrowth:null}}}});
  assert.match(panel,/8,192 MB/);assert.match(panel,/1,024 MB/);assert.match(panel,/7,168 MB/);
  assert.match(panel,/Want to extend/);assert.match(panel,/Unknown — not returned/);
  assert.doesNotMatch(panel,/AUTO-GROWTH ENABLED/);
  const unknown=destinationCapacityPanel({inspections:{target:{ref:'b'.repeat(20),databaseBytes:10}}});
  assert.match(unknown,/data-free-mb>Unknown/);assert.doesNotMatch(unknown,/500 MB|200 GB/);
});
test('dashboard route retains the complete graphical screen rather than replacing it with a picker page',async()=>{
  const route=await readFile(new URL('../src/console/ConsoleApp.jsx',import.meta.url),'utf8');
  assert.match(route,/case 'dashboard':[\s\S]*?body = <EnclaveDashboard/);
  assert.doesNotMatch(route,/body = <OneTwoThreeDone/);
});
test('older partial saved choices cannot blank the recovery screen on reload',()=>{
  const state=restoreRecoveryState({version:RECOVERY_SCREEN_VERSION,selection:{source:'a',target:'b'},inspections:undefined});
  assert.equal(recoveryScene(state).state,'select_projects');
  assert.deepEqual(state.selection.sources,[]);assert.deepEqual(state.inspections,{});
});
