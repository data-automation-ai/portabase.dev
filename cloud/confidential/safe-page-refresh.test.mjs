import test from 'node:test';
import assert from 'node:assert/strict';
import {startSafeRefresh} from './safe-page-refresh.mjs';

function page() {
  const listeners={},timers=[];
  let open=false,reloads=0;
  const document={body:{dataset:{refreshMs:'30000'}},activeElement:null,
    addEventListener:(type,listener)=>{listeners[type]=listener;},
    querySelector:()=>open?{}:null};
  const window={setTimeout:(fn,delay)=>timers.push({fn,delay}),location:{reload:()=>reloads++}};
  startSafeRefresh(document,window);
  return {timers,listeners,setOpen:value=>{open=value;},reloads:()=>reloads};
}

test('refresh waits for the open selector and resumes after it is closed',()=>{
  const p=page();p.setOpen(true);
  const scheduled=p.timers.shift();assert.equal(scheduled.delay,30000);scheduled.fn();
  assert.equal(p.reloads(),0);
  p.setOpen(false);p.timers.shift().fn();
  assert.equal(p.reloads(),1);
});

test('refresh does not discard an edited authorization or selection form',()=>{
  const p=page();
  p.listeners.input({target:{matches:()=>true}});
  p.timers.shift().fn();p.timers.shift().fn();
  assert.equal(p.reloads(),0);
});
