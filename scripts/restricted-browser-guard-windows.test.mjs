import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../client-app/browser-engine/extension/background.js', import.meta.url), 'utf8');
const launch = readFileSync(new URL('../client-app/browser-engine/kaizen-engine.js', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../client-app/browser-engine/extension/manifest.json', import.meta.url), 'utf8'));
assert.equal(manifest.version, '1.7.3');
assert.ok(manifest.permissions.includes('tabs'));
assert.match(launch, /browserExtensionsAccess: extensionsUiAccess/);
assert.match(launch, /USERFLEX_BROWSER_EXTENSIONS_ACCESS/);
assert.match(launch, /USERFLEX_PROFILE_HOME_URL/);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const handler = () => ({ addListener(fn) { this.callback = fn; } });

function createCase(mode) {
  const initial = new Map();
  const events = {
    newWindow: handler(),
    focusChanged: handler(),
    startup: handler(),
  };
  const opened = [];
  const closed = [];
  const noop = handler();
  let nextId = 77;
  const chrome = {
    tabs: { onUpdated: handler(), onCreated: handler(), update: async () => null },
    webNavigation: { onBeforeNavigate: handler() },
    windows: {
      onCreated: events.newWindow,
      onFocusChanged: events.focusChanged,
      get: async (id) => {
        if (!initial.has(id)) throw new Error('window closed');
        return initial.get(id);
      },
      getAll: async () => Array.from(initial.values()),
      create: async (options) => {
        const window = { id: nextId++, type: options.type, tabs: [{ url: options.url }] };
        opened.push(options);
        initial.set(window.id, window);
        events.newWindow.callback?.(window);
        return window;
      },
      remove: async (id) => {
        if (!initial.has(id)) throw new Error('already closed');
        initial.delete(id);
        closed.push(id);
      },
    },
    management: {
      getAll: async () => [{id:'toolspoint-id', name:'Toolspoint-Extension', enabled:true}],
      setEnabled: async () => null,
      onDisabled: handler(),
      onInstalled: handler(),
      onUninstalled: handler(),
    },
    runtime: {
      onStartup: events.startup,
      onInstalled: handler(),
      getPlatformInfo: async () => ({}),
    },
    alarms: { create() {}, onAlarm: handler() },
  };
  const ctx = {
    console: { warn() {} },
    chrome,
    URL,
    Set,
    Promise,
    setTimeout,
    clearTimeout,
    importScripts: () => {},
    USERFLEX_BROWSER_EXTENSIONS_ACCESS: mode,
    USERFLEX_PROFILE_HOME_URL: 'https://profile.example/',
    USERFLEX_RUNTIME_STRATEGY: 'guard-only',
    USERFLEX_EXPECTED_MANAGED_EXTENSIONS: ['ex1','ex2','Toolspoint-Extension'],
  };
  ctx.globalThis = ctx;
  vm.runInNewContext(source,ctx,{filename:'background.js'});
  return { initial, events, opened, closed, chrome };
}

{
  const ctx = createCase('restricted');
  ctx.initial.set(23,{id:23,type:'normal',tabs:[
    {url:'https://member.toolspoint.net/member'},
    {url:'https://chatgpt.com/'},
  ]});
  ctx.events.newWindow.callback({ id:23, type:'normal' });
  await delay(370);
  assert.equal(ctx.opened.length,2,'every original page becomes controlled popup');
  assert.ok(ctx.opened.every(w=>w.type==='popup'));
  assert.ok(ctx.opened.some(w=>w.url==='https://member.toolspoint.net/member'));
  assert.ok(ctx.opened.some(w=>w.url==='https://chatgpt.com/'));
  assert.deepEqual(ctx.closed,[23],'normal browser window is closed only after a replacement exists');
  assert.equal(ctx.opened.length,2,'popup windows must not be reconverted');
}
{
  const ctx = createCase('restricted');
  ctx.initial.set(35,{id:35,type:'normal',tabs:[{url:'edge://extensions/'}]});
  ctx.events.focusChanged.callback(35);
  await delay(360);
  assert.deepEqual(ctx.opened.map(w=>w.url),['https://profile.example/'],
    'internal Edge pages are not allowed in managed popups');
  assert.deepEqual(ctx.closed,[35]);
}
{
  const ctx = createCase('restricted');
  ctx.initial.set(40,{id:40,type:'popup',tabs:[{url:'https://profile.example/'}]});
  ctx.events.newWindow.callback({id:40,type:'popup'});
  await delay(50);
  assert.equal(ctx.closed.length,0,'original --app/popup window remains visible');
}
{
  const ctx = createCase('full');
  assert.equal(ctx.events.newWindow.callback,undefined,'full mode must never restrict additional windows');
  ctx.initial.set(50,{id:50,type:'normal',tabs:[{url:'https://member.toolspoint.net/'}]});
  await delay(350);
  assert.equal(ctx.opened.length,0);
  assert.equal(ctx.closed.length,0);
}
// Disabling any assigned extension must close the whole managed browser
// profile, and the same applies if it was uninstalled after being discovered.
{
  const ctx = createCase('restricted');
  ctx.initial.set(70,{id:70,type:'popup',tabs:[{url:'https://profile.example/'}]});
  await delay(15);
  ctx.chrome.management.onDisabled.callback({id:'toolspoint-id',name:'Toolspoint-Extension'});
  await delay(35);
  assert.ok(ctx.closed.includes(70),'disable managed extension must close the restricted profile');
}
{
  const ctx = createCase('restricted');
  ctx.initial.set(71,{id:71,type:'popup',tabs:[{url:'https://profile.example/'}]});
  await delay(15);
  ctx.chrome.management.onUninstalled.callback('toolspoint-id');
  await delay(35);
  assert.ok(ctx.closed.includes(71),'uninstall managed extension must close the restricted profile');
}
console.log('Browser Guard additional Edge window restriction and extension tamper detection: OK');
