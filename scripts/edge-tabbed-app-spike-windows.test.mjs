import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { connectKaizenBrowser } from '../client-app/browser-engine/session-state.js';

// Experimental Windows smoke test. NOT production code. Verify whether Edge
// lets chrome.tabs.create put a second live tab in its toolbar-free --app window.
async function waitFor(check, ms = 25000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const value = await check(); if (value) return value; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Timed out waiting for Edge tabbed app experiment');
}
async function findEdge() {
  for (const base of [process.env['PROGRAMFILES(X86)'],process.env.PROGRAMFILES,process.env.LOCALAPPDATA]) {
    if (!base) continue;
    const exe = path.join(base,'Microsoft','Edge','Application','msedge.exe');
    try { await readFile(exe); return exe; } catch {}
  }
  throw new Error('Edge not installed');
}
function killTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve();
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {windowsHide:true}, () => resolve());
  });
}
assert.equal(process.platform, 'win32');
const root = await mkdtemp(path.join(tmpdir(),'userflow-tabbed-app-probe-'));
const profile = path.join(root,'edge-profile');
const extension = path.join(root,'extension');
const server = createServer((req,res) => {
  res.writeHead(200, {'content-type':'text/html'});
  res.end('<!doctype html><title>UserFlow Experimental Page</title><h1>Tab test</h1>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let child; let browser; let session;
try {
  await cp(new URL('../client-app/browser-engine/extension', import.meta.url), extension, {recursive:true});
  await writeFile(path.join(extension,'strategy.js'), [
    "globalThis.USERFLEX_BROWSER_EXTENSIONS_ACCESS = 'restricted';",
    "globalThis.USERFLEX_RUNTIME_STRATEGY = 'guard-only';",
    "globalThis.USERFLEX_EXPECTED_MANAGED_EXTENSIONS = [];",
    "globalThis.USERFLEX_CONTENT_RULES = [];",
  ].join('\n'));
  const port = 9537;
  const origin = 'http://127.0.0.1:' + server.address().port;
  const edge = await findEdge();
  child = spawn(edge, [
    '--user-data-dir='+profile,
    '--remote-debugging-port='+port,
    '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions-except='+extension,
    '--load-extension='+extension,
    '--app='+origin+'/index',
  ], {stdio:'ignore', windowsHide:false});
  await waitFor(async() => (await fetch('http://127.0.0.1:'+port+'/json/version')).ok, 30000);
  browser = await connectKaizenBrowser(port);
  const worker = await waitFor(() => browser.targets().find(t =>
    t.type() === 'service_worker' && /chrome-extension:\/\/.+\/background\.js/.test(t.url())), 15000);
  session = await worker.createCDPSession();
  await session.send('Runtime.enable');
  const result = await session.send('Runtime.evaluate', {
    expression: `(async () => {
      const initial = await chrome.windows.getAll({populate:true});
      const win = initial.find(w => (w.tabs||[]).some(t => (t.url||'').includes('/index')));
      if (!win) return {error:'Missing app window',initial};
      try {
        const tab = await chrome.tabs.create({windowId:win.id,url:'${origin}/second',active:true});
        await new Promise(r => setTimeout(r,700));
        const after = await chrome.windows.getAll({populate:true});
        return {
          initial: initial.map(w => ({id:w.id,type:w.type,tabCount:w.tabs?.length})),
          created: {id:tab.id,windowId:tab.windowId},
          after: after.map(w => ({id:w.id,type:w.type,urls:(w.tabs||[]).map(t=>t.url)})),
        };
      } catch (e) {
        return {error:String(e?.message||e),initial: initial.map(w=>({id:w.id,type:w.type}))};
      }
    })()`,
    awaitPromise:true,
    returnByValue:true,
  });
  const value = result?.result?.value;
  console.log('USERFLOW_EDGE_TABBED_APP_PROBE='+JSON.stringify(value));
  assert.ok(value && !value.error, 'Cannot add a live tab inside restricted Edge app window');
  assert.equal(value.after.length,1, 'Opening an internal tab created another native Edge window');
  assert.ok(value.after[0].type !== 'normal', 'A toolbar-bearing Edge window leaked');
  assert.ok(value.after[0].urls.some(u=>u?.includes('/second')), 'Second tab missing from app window');
} finally {
  await session?.detach().catch(()=>{});
  await browser?.disconnect().catch(()=>{});
  await killTree(child?.pid);
  await new Promise((resolve)=>server.close(resolve));
  await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:250}).catch(()=>{});
}
