import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, cp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawn, execFile } from 'node:child_process';
import path from 'node:path';
import { inspectFixtureWindows } from './edge-test-window-inspection.mjs';
import { connectKaizenBrowser } from '../client-app/browser-engine/session-state.js';
import { startRestrictedTabbedGuard } from '../client-app/browser-engine/restricted-window-guard.js';

async function until(check, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < end) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) { last = String(error); }
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  throw new Error('Timed out waiting for Edge tabs: ' + last);
}
async function findEdge() {
  for (const directory of [process.env['PROGRAMFILES(X86)'], process.env.PROGRAMFILES, process.env.LOCALAPPDATA]) {
    if (!directory) continue;
    const file = path.join(directory, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    try { await readFile(file); return file; } catch {}
  }
  throw new Error('Microsoft Edge is not installed');
}
function killTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve();
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

assert.equal(process.platform, 'win32');
const root = await mkdtemp(path.join(tmpdir(), 'userflow-tabs-one-window-'));
const userData = path.join(root, 'edge-profile');
const guardPath = path.join(root, 'browser-guard');
const backupPath = path.join(root, 'backup-guard');
const mockPath = path.join(root, 'mock-ex1');
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (pathname === '/index') {
    res.setHeader('Set-Cookie', 'managedSession=preserved; Path=/; SameSite=Lax');
    return res.end('<title>ToolsPoint mock</title><a href="/secondary" target="_blank">Open Claude</a>');
  }
  return res.end('<title>' + pathname + '</title><h1>' + pathname + '</h1>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let proc, browser, session;
try {
  await cp(new URL('../client-app/browser-engine/extension', import.meta.url), guardPath, { recursive: true });
  await cp(new URL('../client-app/browser-engine/backup-guard', import.meta.url), backupPath, { recursive: true });
  await mkdir(mockPath, { recursive: true });
  await writeFile(path.join(mockPath, 'manifest.json'), JSON.stringify({
    manifest_version: 3, name: 'ex1', version: '1.0',
    permissions: ['management'],
    background: {service_worker:'bg.js'},
    content_scripts: [{matches:['http://*/*'],js:['content.js'],run_at:'document_start'}]
  }));
  await writeFile(path.join(mockPath, 'bg.js'),
    "chrome.runtime.onMessage.addListener(()=>{});chrome.runtime.onStartup.addListener(()=>{});");
  await writeFile(path.join(mockPath, 'content.js'),
    "document.documentElement.dataset.ex1Loaded = 'yes';chrome.runtime.sendMessage({ping:true}).catch(()=>{});");
  const base = 'http://127.0.0.1:' + server.address().port;
  await writeFile(path.join(guardPath, 'strategy.js'), [
    "globalThis.USERFLEX_BROWSER_EXTENSIONS_ACCESS = 'restricted';",
    "globalThis.USERFLEX_RESTRICTED_TABBED_BROWSER = true;",
    "globalThis.USERFLEX_RUNTIME_STRATEGY = 'guard-only';",
    "globalThis.USERFLEX_EXPECTED_MANAGED_EXTENSIONS = ['ex1'];",
    "globalThis.USERFLEX_CONTENT_RULES = [];",
    "globalThis.USERFLEX_PROFILE_HOME_URL = " + JSON.stringify(base + '/index') + ';'
  ].join('\n'));
  const executable = await findEdge();
  const port = 9549;
  proc = spawn(executable, [
    '--user-data-dir=' + userData,
    '--remote-debugging-port=' + port,
    '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    '--disable-extensions-except=' + guardPath + ',' + backupPath + ',' + mockPath,
    '--load-extension=' + guardPath + ',' + backupPath + ',' + mockPath,
    base + '/index'
  ], { stdio:'ignore', windowsHide:false });
  await until(async () => (await fetch('http://127.0.0.1:' + port + '/json/version')).ok, 30000);
  browser = await connectKaizenBrowser(port);
  const home = await until(async () => {
    const pages = await browser.pages();
    return pages.find((p) => p.url().includes('/index'));
  });
  // Two installed extensions have a background.js worker. Select the
  // Browser Guard by manifest name, not target enumeration order.
  const worker = await until(async () => {
    for (const target of browser.targets().filter((t) =>
      t.type() === 'service_worker' && /chrome-extension:\/\/.+\/background\.js/.test(t.url()))) {
      const probe = await target.createCDPSession().catch(() => null);
      if (!probe) continue;
      try {
        const reply = await probe.send('Runtime.evaluate', {
          expression: 'chrome.runtime.getManifest().name',
          returnByValue: true
        });
        if (reply?.result?.value === 'userFLEX Browser Guard') return target;
      } catch {} finally { await probe.detach().catch(() => null); }
    }
    return null;
  }, 20000);
  const navigationGuard = await startRestrictedTabbedGuard({
    browser, debugPort: port,
  });
  session = await worker.createCDPSession();
  await session.send('Runtime.enable');
  let lastWindowState = '';
  const inspect = async () => {
    const items = await inspectFixtureWindows(browser, session, base);
    if (JSON.stringify(items) !== lastWindowState) {
      lastWindowState = JSON.stringify(items);
      console.log('EDGE_NATIVE_TABS_STATE=' + lastWindowState);
    }
    return items;
  };
  await home.click('a');
  const secondary = await until(async () => (await browser.pages()).find(p => p.url().includes('/secondary')));
  await until(async () => (await secondary.evaluate(
    () => document.documentElement.dataset.ex1Loaded)) === 'yes', 10000);
  assert.equal(await secondary.evaluate(() => document.cookie.includes('managedSession=preserved')), true,
    'child tab must keep the same cookie/session as the original profile');
  const beforePopup = await until(async () => {
    const windows = await inspect();
    return Array.isArray(windows) && windows.length === 1
      && windows[0].type === 'normal'
      && windows[0].urls.some((u) => u?.includes('/secondary')) ? windows : false;
  });
  assert.equal(beforePopup.length,1);
  // Explicit window dimensions force a real popup native window on Edge.
  await home.evaluate(() => window.open('/popup', 'toolspoint-popup', 'width=400,height=420'));
  const afterPopup = await until(async () => {
    const windows = await inspect();
    return Array.isArray(windows) && windows.length === 1
      && windows[0].urls.some(u => u?.includes('/popup')) ? windows : false;
  }, 12000);
  assert.equal(afterPopup[0].type, 'normal', 'only normal tabbed Edge window remains');
  assert.ok(afterPopup[0].urls.some(u => u?.includes('/index')));
  assert.ok(afterPopup[0].urls.some(u => u?.includes('/secondary')));
  assert.ok(afterPopup[0].urls.some(u => u?.includes('/popup')));
  console.log('USERFLOW_RESTRICTED_TABBED_WINDOWS='+JSON.stringify(afterPopup));
  // Browser Guard is a distinct extension from ex1. Simulate an attacker
  // disabling Browser Guard from another extension with management access.
  const ex1Worker = await until(() => browser.targets().find((t) =>
    t.type() === 'service_worker' && /chrome-extension:\/\/.+\/bg\.js/.test(t.url())), 10000);
  const ex1Session = await ex1Worker.createCDPSession();
  try {
    await ex1Session.send('Runtime.enable');
    const response = await ex1Session.send('Runtime.evaluate', {
      expression: `(async()=>{const items=await chrome.management.getAll();
        const guard=items.find(x=>x.name==='userFLEX Browser Guard');
        if(!guard) throw new Error('Browser Guard missing');
        await chrome.management.setEnabled(guard.id,false);
        return true;})()`,
      awaitPromise:true, returnByValue:true
    });
    assert.equal(response?.result?.value,true,'simulated disable must succeed');
    await until(async () => {
      try {
        const pages = await browser.pages();
        return pages.filter((page) => page.url().startsWith('http')).length === 0;
      } catch {
        // Edge disconnects CDP when its final profile window closes.
        return true;
      }
    }, 12000);
    console.log('USERFLOW_BACKUP_GUARD_CLOSED_PROFILE=true');
  } finally {
    await ex1Session.detach().catch(() => {});
  }
  for (const preferenceFile of ['Preferences', 'Secure Preferences']) {
    try {
      const prefs = JSON.parse(await readFile(path.join(userData,'Default',preferenceFile),'utf8'));
      const settings = prefs?.extensions?.settings || {};
      console.log('USERFLOW_EXTENSION_PREFERENCES_'+preferenceFile.replace(' ','_')+'='+JSON.stringify(
        Object.values(settings).map(x => ({name:String(x?.manifest?.name || ''),state:x?.state}))
          .filter(x=>['userFLEX Browser Guard','ex1'].includes(x.name))
      ));
    } catch (error) {
      console.log('USERFLOW_EXTENSION_PREFERENCES_'+preferenceFile.replace(' ','_')+'=unavailable');
    }
  }
} finally {
  await browser?.disconnect().catch(() => {});
  await session?.detach().catch(() => {});
  await killTree(proc?.pid);
  await new Promise(resolve => server.close(resolve));
  await rm(root, {recursive:true, force:true, maxRetries:6, retryDelay:300}).catch(() => {});
}
