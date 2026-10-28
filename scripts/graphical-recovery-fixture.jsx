// Isolated browser acceptance fixture. No provider credentials or jobs.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {EnclaveDashboard} from '../src/console/enclave-dashboard.jsx';
let offline=false;
const source='a'.repeat(20),target='b'.repeat(20);
const db={id:'fixture-db',projectRef:source,projectName:'Fixture Source',databaseName:'postgres',name:'Fixture Source (postgres)',enabled:true,mode:'structure_and_data',estimatedSizeMb:3,
  tables:['accounts','orders'].map((name,i)=>({name:'public.'+name,schema:'public',objectName:name,objectType:'TABLE',mode:'structure_and_data',sizeMb:i+1,structureSizeMb:0})),
  binaries:['alpha.png','beta.png'].map(name=>({name:'images/'+name,bucket:'images',schema:'images',objectName:name,objectType:'BINARY',mode:'include',sizeMb:1}))};
async function fixtureApi(action,slot){
  if(offline)throw Error('Simulated connection failure. Last-known readings and selections are retained.');
  if(action==='discover')return {ok:true,connected:true,projects:[{id:slot==='source'?source:target,name:slot==='source'?'Fixture Source':'Fixture Destination'}],databases:slot==='source'?[structuredClone(db)]:[]};
  return {ok:true,inspection:{ref:slot==='source'?source:target,name:slot==='source'?'Fixture Source':'Fixture Destination',databaseBytes:1024**3,storageBytes:10*1024**3,blank:false,checkedAt:'2026-10-28T13:00:00Z',
    diskCapacity:{sizeGb:8,maxAllowedBytes:8*1024**3,diskType:'gp3',autoGrowth:{enabled:true,growthPercent:50,minIncrementGb:4,maxSizeGb:200,maxSizeBytes:200*1024**3}}}};
}
createRoot(document.getElementById('root')).render(<><div style={{padding:8,background:'#fff3cd'}}>Synthetic UI acceptance fixture — provider access and recovery jobs are disabled. <label><input type="checkbox" onChange={e=>{offline=e.target.checked;}}/>Simulate connection failure</label></div><EnclaveDashboard me={{user:{id:'graphical-acceptance-fixture'}}} fixtureApi={fixtureApi}/></>);
