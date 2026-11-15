import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
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
function findEdge() {
  return [
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean)[0];
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
  const edgeExe = findEdge();
  assert.ok(edgeExe, 'Microsoft Edge path is available');
  await readFile(edgeExe);
  const address = httpServer.address();
  const base = `http://127.0.0.1:${address.port}`;
  const portArgs = [
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
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
      const second = spawn(edgeExe, restrictedAppWindowArgs({
        userDataDir,
        url,
      }), { stdio: 'ignore', windowsHide: false });
      second.once('error', (error) => { throw error; });
      second.unref();
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
  console.log('Restricted Edge windows and shared session smoke test: OK');
} finally {
  await guard?.close().catch(() => null);
  await browser?.disconnect().catch(() => null);
  await killTree(child?.pid);
  await new Promise((resolve) => httpServer.close(() => resolve()));
  await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 400 }).catch(() => null);
}
