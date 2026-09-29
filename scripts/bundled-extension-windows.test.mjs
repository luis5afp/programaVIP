import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { unzipSync } from 'fflate';
import { bundledExtensions } from '../cloudflare/lib/builtin-extensions.ts';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJson(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) return await response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function findEdge() {
  const candidates = [
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await readFile(candidate);
      return candidate;
    } catch {}
  }
  throw new Error(`Microsoft Edge was not found. Tried: ${candidates.join(', ')}`);
}

async function unpack(bytes, target) {
  const archive = unzipSync(bytes);
  for (const [name, data] of Object.entries(archive)) {
    const normalized = String(name).replace(/\\/g, '/');
    assert.ok(normalized && !normalized.startsWith('/') && !normalized.includes('../'), `unsafe zip path: ${name}`);
    const file = path.join(target, ...normalized.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  }
}

async function killTree(pid) {
  if (!pid) return;
  await new Promise((resolve) => {
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

async function seedDeveloperModeWarningSnooze(profileDir) {
  const defaultDir = path.join(profileDir, 'Default');
  await mkdir(defaultDir, { recursive: true });
  const preferencesPath = path.join(defaultDir, 'Preferences');
  const preferences = {
    extensions: {
      ui: {
        dev_mode_warning_snooze_end_time: '99999999999000000',
      },
    },
  };
  await writeFile(preferencesPath, JSON.stringify(preferences), 'utf8');
}

function websocketRpc(socket) {
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data || '{}'));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
    else resolve(message.result);
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function testExtension(edgeExe, definition, index, pageUrl) {
  const root = await mkdtemp(path.join(tmpdir(), `userflex-${definition.name}-`));
  const extensionDir = path.join(root, 'extension');
  const profileDir = path.join(root, 'profile');
  const port = 9330 + index;
  await mkdir(extensionDir, { recursive: true });
  await mkdir(profileDir, { recursive: true });
  await unpack(definition.packageBytes, extensionDir);
  await seedDeveloperModeWarningSnooze(profileDir);

  const manifest = JSON.parse(await readFile(path.join(extensionDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, definition.name);
  assert.equal(manifest.version, definition.version);
  assert.ok((manifest.permissions || []).includes('management'));
  assert.ok(!(manifest.permissions || []).includes('proxy'));
  assert.ok(!(manifest.permissions || []).includes('debugger'));
  assert.ok(!(manifest.permissions || []).includes('nativeMessaging'));

  const args = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-address=127.0.0.1`,
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-component-update',
    '--disable-features=ExtensionsMenuAccessControl,ExtensionsToolbarZeroState,ExtensionsToolbarMenu',
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    'about:blank',
  ];

  const child = spawn(edgeExe, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
    if (stderr.length > 12000) stderr = stderr.slice(-12000);
  });

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`, 25000);

    const persistedPreferences = JSON.parse(await readFile(path.join(profileDir, 'Default', 'Preferences'), 'utf8'));
    assert.equal(
      persistedPreferences?.extensions?.ui?.dev_mode_warning_snooze_end_time,
      '99999999999000000',
      `${definition.name}: Edge discarded the managed developer-mode warning snooze preference`,
    );

    // Mirror userFLOW: Edge starts on about:blank, waits briefly for
    // --load-extension registration, then performs the first real navigation.
    await delay(1600);

    const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`, 10000);
    const page = targets.find((target) => target.type === 'page');
    assert.ok(page?.webSocketDebuggerUrl, `${definition.name}: bootstrap page target was not created`);

    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket timeout')), 10000);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener('error', (event) => {
        clearTimeout(timer);
        reject(new Error(`WebSocket failed: ${event?.message || 'unknown'}`));
      }, { once: true });
    });
    const rpc = websocketRpc(socket);
    await rpc('Runtime.enable');
    await rpc('Page.enable');
    await rpc('Page.navigate', { url: pageUrl });
    await delay(1400);

    const locationResult = await rpc('Runtime.evaluate', {
      expression: 'location.href',
      returnByValue: true,
    });
    assert.ok(
      String(locationResult?.result?.value || '').startsWith(pageUrl),
      `${definition.name}: Edge did not reach the test page`,
    );

    const contextExpression = `document.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`;
    const contextResult = await rpc('Runtime.evaluate', {
      expression: contextExpression,
      returnByValue: true,
    });

    assert.equal(
      contextResult?.result?.value,
      false,
      `${definition.name}: content script was not active on the first managed navigation`,
    );

    if (definition.name === 'ex1') {
      await rpc('Runtime.evaluate', {
        expression: `document.body.innerHTML='<div id="ufx-email">usuario@example.com</div>'; true`,
        returnByValue: true,
      });
      await delay(1200);
      const emailResult = await rpc('Runtime.evaluate', {
        expression: `document.getElementById('ufx-email')?.textContent`,
        returnByValue: true,
      });
      const text = String(emailResult?.result?.value || '');
      assert.notEqual(text, 'usuario@example.com', 'ex1: privacy mask did not react to DOM mutation');
      assert.match(text, /@example\.com$/, 'ex1: privacy mask produced an unexpected value');
    }

    socket.close();
    console.log(`${definition.name} v${definition.version}: Edge runtime smoke test OK`);
  } catch (error) {
    const detail = stderr.trim() ? `\nEdge stderr:\n${stderr}` : '';
    throw new Error(`${definition.name} runtime test failed: ${error.message}${detail}`);
  } finally {
    await killTree(child.pid);
    await rm(root, { recursive: true, force: true }).catch(() => null);
  }
}

const server = createServer((_request, response) => {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end('<!doctype html><html><body><main id="root">userFLEX extension smoke test</main></body></html>');
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

try {
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const pageUrl = `http://127.0.0.1:${address.port}/`;
  const edgeExe = await findEdge();
  const definitions = bundledExtensions();
  assert.deepEqual(definitions.map((item) => item.name), ['ex1', 'ex2']);

  for (let index = 0; index < definitions.length; index += 1) {
    await testExtension(edgeExe, definitions[index], index, pageUrl);
  }

  console.log('Bundled ex1/ex2 Windows runtime validation: OK');
} finally {
  await new Promise((resolve) => server.close(() => resolve()));
}
