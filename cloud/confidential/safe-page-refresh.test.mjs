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

test('oauth_complete notifies opener, closes popup window, and replaces history', () => {
  let postedMessage = null, postedTarget = null, closed = false, replacedUrl = null;
  const mockOpener = {
    postMessage: (msg, target) => { postedMessage = msg; postedTarget = target; },
  };
  const window = {
    location: { search: '?oauth_complete=dropbox', reload: () => {} },
    opener: mockOpener,
    close: () => { closed = true; },
    history: { replaceState: (_state, _title, url) => { replacedUrl = url; } },
    addEventListener: () => {},
  };
  const document = { body: { dataset: {} }, addEventListener: () => {} };
  startSafeRefresh(document, window);
  assert.deepEqual(postedMessage, { type: 'portabase_oauth_complete' });
  assert.equal(postedTarget, '*');
  assert.equal(closed, true);
  assert.equal(replacedUrl, '/');
});

test('message event with portabase_oauth_complete reloads page', () => {
  let reloads = 0;
  const windowListeners = {};
  const window = {
    addEventListener: (type, fn) => { windowListeners[type] = fn; },
    location: { reload: () => { reloads++; } },
  };
  const document = { body: { dataset: {} }, addEventListener: () => {} };
  startSafeRefresh(document, window);
  assert.ok(windowListeners.message);
  windowListeners.message({ data: { type: 'other_message' } });
  assert.equal(reloads, 0);
  windowListeners.message({ data: { type: 'portabase_oauth_complete' } });
  assert.equal(reloads, 1);
});

test('click on data-oauth-popup link opens popup and prevents default', () => {
  let openedUrl = null, openedName = null, openedFeatures = null, defaultPrevented = false;
  const docListeners = {};
  const document = {
    body: { dataset: {} },
    addEventListener: (type, fn) => { docListeners[type] = fn; },
  };
  const window = {
    open: (url, name, features) => {
      openedUrl = url; openedName = name; openedFeatures = features;
      return {};
    },
  };
  startSafeRefresh(document, window);
  assert.ok(docListeners.click);

  const nonLinkEvent = {
    target: { closest: () => null },
    preventDefault: () => { defaultPrevented = true; },
  };
  docListeners.click(nonLinkEvent);
  assert.equal(openedUrl, null);
  assert.equal(defaultPrevented, false);

  const linkEvent = {
    target: {
      closest: sel => sel === 'a[data-oauth-popup="true"]' ? { href: 'http://localhost:58441/oauth/dropbox/callback' } : null,
    },
    preventDefault: () => { defaultPrevented = true; },
  };
  docListeners.click(linkEvent);
  assert.equal(openedUrl, 'http://localhost:58441/oauth/dropbox/callback');
  assert.equal(openedName, 'portabase_oauth');
  assert.equal(openedFeatures, 'popup,width=640,height=760');
  assert.equal(defaultPrevented, true);
});

test('click on [data-copy-url] copies URL to clipboard and changes text for 2 seconds', async () => {
  let copiedText = null;
  const docListeners = {};
  const timers = [];
  const document = {
    body: { dataset: {} },
    addEventListener: (type, fn) => { docListeners[type] = fn; },
  };
  const window = {
    navigator: {
      clipboard: {
        writeText: async text => { copiedText = text; },
      },
    },
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); },
  };
  startSafeRefresh(document, window);
  assert.ok(docListeners.click);

  let textContent = '📋 Copy Link for Incognito Window';
  const mockBtn = {
    get textContent() { return textContent; },
    set textContent(val) { textContent = val; },
    getAttribute: attr => attr === 'data-copy-url' ? 'https://api.supabase.com/v1/oauth/authorize?prompt=login' : null,
  };
  const event = {
    target: {
      closest: sel => sel === '[data-copy-url]' ? mockBtn : null,
    },
  };
  docListeners.click(event);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(copiedText, 'https://api.supabase.com/v1/oauth/authorize?prompt=login');
  assert.equal(mockBtn.textContent, '✓ Copied for Incognito!');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 2000);
  timers[0].fn();
  assert.equal(mockBtn.textContent, '📋 Copy Link for Incognito Window');
});
