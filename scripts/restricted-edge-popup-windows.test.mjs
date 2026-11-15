import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, readFile, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { connectKaizenBrowser } from '../client-app/browser-engine/session-state.js';
import {
  startRestrictedWindowGuard,
  restrictedAppWindowArgs,
} from '../client-app/browser-engine/restricted-window-guard.js';

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitFor(check, timeoutMs = 18_000) {
  const until = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < until) {
    try {
      const answer = await check();
      if (answer) return answer;
    } catch (error) { last = String(error); }
    await delay(160);
  }
  throw new Error('Timed out waiting for restricted Edge popup ' + last);
}
async function findEdge() {
  const options = [
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean);
  for (const candidate of options) {
    try { await readFile(candidate); return candidate; } catch {}
  }
  throw new Error('Microsoft Edge is missing on the Windows runner.');
}
function killTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve();
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

assert.equal(process.platform, 'win32');
const root = await mkdtemp(path.join(tmpdir(), 'userflow-restricted-popup-'));
const userDataDir = path.join(root, 'edge-profile');
const browserGuardDir = path.join(root, 'browser-guard');
const port = 9409;
const httpServer = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (url.pathname === '/favicon.ico') return res.end('');
  if (url.pathname === '/index') {
    res.setHeader('Set-Cookie', 'sameProfileTest=passed; Path=/; SameSite=Lax');
    return res.end('<!doctype html><html><body><h1>Restricted Home</h1><a href="/secondary" target="_blank">Open second tab</a></body></html>');
  }
  if (url.pathname === '/secondary') {
    return res.end('<!doctype html><html><body><h1>Secondary profile window</h1></body></html>');
  }
  res.writeHead(404); res.end('Missing');
});
await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
let child = null;
let browser = null;
let guard = null;
try {
  await mkdir(userDataDir, { recursive: true });
  await cp(new URL('../client-app/browser-engine/extension', import.meta.url), browserGuardDir, {recursive: true});
  await writeFile(path.join(browserGuardDir, 'strategy.js'), [
    `globalThis.USERFLEX_BROWSER_EXTENSIONS_ACCESS = 'restricted';`,
    `globalThis.USERFLEX_PROFILE_HOME_URL = 'http://127.0.0.1:${httpServer.address().port}/index';`,
    `globalThis.USERFLEX_RUNTIME_STRATEGY = 'guard-only';`,
    `globalThis.USERFLEX_EXPECTED_MANAGED_EXTENSIONS = [];`,
    `globalThis.USERFLEX_CONTENT_RULES = [];`,
    '',
  ].join('\n'));

  const edgeExe = await findEdge();
  const address = httpServer.address();
  const base = `http://127.0.0.1:${address.port}`;
  const portArgs = [
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    `--disable-extensions-except=${browserGuardDir}`,
    `--load-extension=${browserGuardDir}`,
    `--app=${base}/index`,
  ];
  child = spawn(edgeExe, portArgs, { stdio: 'ignore', windowsHide: false });
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    return response.ok;
  }, 30_000);
  browser = await connectKaizenBrowser(port);
  const home = await waitFor(async () => {
    const pages = await browser.pages();
    return pages.find((page) => page.url().includes('/index'));
  });
  let appWindowLaunches = 0;
  guard = await startRestrictedWindowGuard({
    connectBrowser: connectKaizenBrowser,
    debugPort: port,
    initialUrl: `${base}/index`,
    settleMs: 200,
    launchAppWindow: async (url) => {
      appWindowLaunches += 1;
      await new Promise((resolve, reject) => {
        const second = spawn(edgeExe, restrictedAppWindowArgs({ userDataDir, url }), {
          stdio: 'ignore', windowsHide: false,
        });
        second.once('error', reject);
        second.once('spawn', () => {
          second.unref();
          resolve();
        });
      });
    },
  });
  await home.evaluate(() => {
    const link = document.querySelector('a[target="_blank"]');
    link.click();
  });
  await waitFor(() => guard.routedCount >= 1);
  const second = await waitFor(async () => {
    const pages = await browser.pages();
    return pages.find((page) => page.url().includes('/secondary'));
  });
  assert.ok(second, 'second page opened in same browser profile');
  const hasCookie = await second.evaluate(() => document.cookie.includes('sameProfileTest=passed'));
  assert.equal(hasCookie, true, 'second app window shares real browser cookies');
  assert.equal(appWindowLaunches, 1, 'one original popup yields exactly one controlled app window');
  assert.equal(home.isClosed(), false, 'first app window stays available');

  // Unlike a mere successful navigation, inspect the native window types:
  // "normal" exposes the Edge extensions toolbar and means restricted mode
  // is still leaking. The mandatory Browser Guard must convert it to popup.
  const worker = await waitFor(() => browser.targets().find((target) =>
    target.type() === 'service_worker' && /chrome-extension:\/\/.+\/background\.js/.test(target.url())), 15_000);
  const session = await worker.createCDPSession();
  try {
    await session.send('Runtime.enable');
    const types = await waitFor(async () => {
      const reply = await session.send('Runtime.evaluate', {
        expression: 'chrome.windows.getAll({populate:true}).then(ws => ws.map(w => ({id:w.id,type:w.type,urls:(w.tabs||[]).map(t=>t.url)})))',
        awaitPromise: true,
        returnByValue: true,
      });
      const items = reply?.result?.value;
      if (!Array.isArray(items)) return null;
      if (items.some((w) => w.type === 'normal')) return null;
      return items.filter((w) => ['popup','app'].includes(w.type)).length >= 2 ? items : null;
    }, 12_000);
    assert.ok(types.every((window) => window.type !== 'normal'),
      'restricted profiles must not leave normal Edge windows with extension buttons');
    assert.ok(types.some((w) => (w.urls||[]).some((url) => url?.includes('/secondary'))),
      'secondary page must be reachable in a toolbar-free popup/app window');
  } finally {
    await session.detach().catch(() => null);
  }
  console.log('Restricted Edge windows, native window types and shared session: OK');
} finally {
  await guard?.close().catch(() => null);
  await browser?.disconnect().catch(() => null);
  await killTree(child?.pid);
  await new Promise((resolve) => httpServer.close(() => resolve()));
  await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 400 }).catch(() => null);
}
