import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { startKaizenProxyRelay } from './proxy-relay.js';
import {
  closeDevtoolsTargets,
  connectKaizenBrowser,
  navigateBrowserHome,
  restorePortableSession,
} from './session-state.js';

function safeSegment(value, fallback = 'profile') {
  const clean = String(value || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);
  return clean || fallback;
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address !== 'string' ? address.port : 0;
      server.close(() => port ? resolve(port) : reject(new Error('No se pudo reservar un puerto local.')));
    });
  });
}

function existingFile(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolveKaizenBrowserExecutable(resourcesPath = process.resourcesPath) {
  const localApp = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.PROGRAMFILES || '';
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] || '';
  return existingFile([
    path.join(resourcesPath, 'chrome_native', 'chrome.exe'),
    path.join(resourcesPath, 'nstchrome', 'chrome.exe'),
    programFiles && path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    programFilesX86 && path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    localApp && path.join(localApp, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    programFiles && path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    programFilesX86 && path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]);
}

function browserKind(executable, resourcesPath = process.resourcesPath) {
  const normalized = path.resolve(executable).toLowerCase();
  if (normalized === path.resolve(resourcesPath, 'chrome_native', 'chrome.exe').toLowerCase()) return 'chrome_native';
  if (normalized === path.resolve(resourcesPath, 'nstchrome', 'chrome.exe').toLowerCase()) return 'nstchrome';
  if (normalized.endsWith('msedge.exe')) return 'edge';
  return 'chrome';
}

function chromeArgs({ userDataDir, debugPort, proxyRules, extensionDir }) {
  const args = [
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${debugPort}`,
    '--remote-debugging-address=127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
    '--restore-last-session=false',
    '--start-maximized',
    '--disable-features=SignInProfileCreation,SigninConsistency',
    '--disable-password-saving',
    '--disable-save-password-bubble',
    '--disable-autofill',
    '--disable-sync',
    '--allow-browser-signin=false',
    '--force-device-scale-factor=1',
    '--lang=es-ES',
    '--disable-component-update',
    '--disable-background-networking',
    '--disable-client-side-phishing-detection',
    '--disable-default-apps',
    '--disable-domain-reliability',
    '--disable-features=OptimizationHints,MediaRouter,SignInProfileCreation,SigninConsistency',
    '--disable-popup-blocking',
  ];
  if (proxyRules) args.push(`--proxy-server=${proxyRules}`, '--proxy-bypass-list=<-loopback>');
  if (extensionDir && fs.existsSync(path.join(extensionDir, 'manifest.json'))) {
    args.push(`--load-extension=${extensionDir}`);
  }
  args.push('about:blank');
  return args;
}

function runPowerShell(script, timeout = 8_000) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout },
      () => resolve(),
    );
  });
}

async function killStrayProfileProcesses(userDataDir) {
  if (process.platform !== 'win32') return;
  const escaped = userDataDir.replace(/'/g, "''").replace(/\\/g, '\\\\');
  const script = `Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe') -and $_.CommandLine -like '*${escaped}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  await runPowerShell(script);
}

async function killProcessTree(proc) {
  if (!proc?.pid) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      execFile('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, timeout: 8_000 }, () => resolve());
    });
    return;
  }
  try { proc.kill('SIGTERM'); } catch {}
}

async function browserPublicIp(debugPort) {
  const browser = await connectKaizenBrowser(debugPort);
  try {
    const page = (await browser.pages())[0] || await browser.newPage();
    await page.goto('https://api.ipify.org?format=json', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    const body = await page.evaluate(() => document.body?.innerText || '');
    const parsed = JSON.parse(body);
    return typeof parsed?.ip === 'string' ? parsed.ip.trim() : null;
  } catch {
    return null;
  } finally {
    await browser.disconnect().catch(() => null);
  }
}

export function createKaizenBrowserEngine({ app, onClosed, log = console } = {}) {
  if (!app || typeof app.getPath !== 'function') throw new Error('El motor KAIZEN requiere la instancia de Electron app.');
  const processes = new Map();

  const profileKey = (clientId, profileId) => `${safeSegment(clientId, 'client')}:${safeSegment(profileId)}`;
  const profileDir = (clientId, profileId) => path.join(
    app.getPath('userData'),
    'browserProfilesData',
    safeSegment(clientId, 'client'),
    safeSegment(profileId),
  );

  async function cleanup(entry, reason = 'closed') {
    if (!entry || entry.cleaned) return;
    entry.cleaned = true;
    if (entry.devtoolsTimer) clearInterval(entry.devtoolsTimer);
    try { await entry.relay?.close(); } catch {}
    if (processes.get(entry.key) === entry) processes.delete(entry.key);
    try { await onClosed?.(entry, reason); } catch (error) {
      log.warn?.('userFLOW KAIZEN onClosed failed:', error?.message || error);
    }
  }

  async function close(clientId, profileId, reason = 'profile_closed') {
    const key = profileKey(clientId, profileId);
    const entry = processes.get(key);
    if (!entry) return false;
    entry.closing = true;
    await killProcessTree(entry.process);
    await cleanup(entry, reason);
    return true;
  }

  async function launch({
    clientId,
    profile,
    connection = { mode: 'direct', locked: false },
    delivery = null,
    usageId = null,
  }) {
    if (!profile?.id || !profile?.url) throw new Error('El perfil no tiene ID o URL.');
    const target = new URL(profile.url);
    if (!['https:', 'http:'].includes(target.protocol)) throw new Error('La URL del perfil no es compatible.');

    const key = profileKey(clientId, profile.id);
    const existing = processes.get(key);
    if (existing && existing.process?.exitCode === null) {
      await navigateBrowserHome(existing.debugPort, profile.url).catch(() => null);
      return {
        ok: true,
        reused: true,
        external: true,
        pid: existing.process.pid,
        browser: existing.browserKind,
        sessionVersion: Number(delivery?.version || 0),
      };
    }

    const executable = resolveKaizenBrowserExecutable();
    if (!executable) {
      throw Object.assign(
        new Error('No se encontró Chrome/Chromium para el motor de perfiles. Instala Google Chrome o incluye chrome_native en userFLOW.'),
        { code: 'KAIZEN_BROWSER_RUNTIME_MISSING' },
      );
    }

    const userDataDir = profileDir(clientId, profile.id);
    await fsp.mkdir(userDataDir, { recursive: true });
    await killStrayProfileProcesses(userDataDir);

    let relay = null;
    let proxyRules = null;
    if (connection?.mode === 'proxy') {
      if (!connection.proxy) throw new Error('El perfil requiere proxy pero el servidor no entregó su configuración.');
      relay = await startKaizenProxyRelay(connection.proxy);
      proxyRules = relay.proxyRules;
    } else if (connection?.locked === true) {
      throw new Error('El perfil exige una salida protegida y no tiene proxy disponible.');
    }

    const debugPort = await freePort();
    const extensionDir = path.join(process.resourcesPath, 'browser-engine', 'extension');
    const args = chromeArgs({ userDataDir, debugPort, proxyRules, extensionDir });
    const proc = spawn(executable, args, {
      detached: false,
      windowsHide: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    const entry = {
      key,
      process: proc,
      clientId,
      profile,
      connection,
      delivery,
      usageId,
      relay,
      debugPort,
      userDataDir,
      executable,
      browserKind: browserKind(executable),
      cleaned: false,
      closing: false,
      stderr: [],
      startedAt: Date.now(),
      devtoolsTimer: null,
    };
    processes.set(key, entry);

    proc.stderr?.on('data', (chunk) => {
      const text = String(chunk || '').trim();
      if (!text) return;
      entry.stderr.push(text.slice(0, 600));
      if (entry.stderr.length > 12) entry.stderr.shift();
    });
    proc.once('error', async (error) => {
      entry.spawnError = error;
      await cleanup(entry, 'spawn_error');
    });
    proc.once('exit', async (code, signal) => {
      entry.exitCode = code;
      entry.signal = signal;
      await cleanup(entry, entry.closing ? 'profile_closed' : 'browser_exit');
    });

    try {
      const browser = await connectKaizenBrowser(debugPort);
      await browser.disconnect().catch(() => null);

      if (connection?.mode === 'proxy') {
        const detectedIp = await browserPublicIp(debugPort);
        if (!detectedIp) throw new Error('No se pudo validar la IP de salida del navegador mediante el proxy.');
        entry.publicIp = detectedIp;
        if (delivery?.expectedPublicIp && detectedIp !== delivery.expectedPublicIp) {
          throw new Error(`La IP del navegador no coincide con la sesión. Esperada: ${delivery.expectedPublicIp}. Detectada: ${detectedIp}.`);
        }
      }

      let restore = null;
      if (profile.sessionMode === 'managed-first-party') {
        if (!delivery?.ready || !delivery?.materialIncluded || !delivery?.material) {
          throw new Error('La sesión administrada todavía no está lista.');
        }
        restore = await restorePortableSession({
          debugPort,
          profileUrl: profile.url,
          material: delivery.material,
        });
      } else {
        await navigateBrowserHome(debugPort, profile.url);
      }

      entry.devtoolsTimer = setInterval(() => void closeDevtoolsTargets(debugPort), 700);
      entry.devtoolsTimer.unref?.();

      return {
        ok: true,
        reused: false,
        external: true,
        pid: proc.pid,
        browser: entry.browserKind,
        debugPort,
        profileDir: userDataDir,
        network: connection?.mode || 'direct',
        networkLocked: connection?.locked === true,
        publicIp: entry.publicIp || null,
        sessionVersion: Number(delivery?.version || 0),
        restore,
      };
    } catch (error) {
      entry.closing = true;
      await killProcessTree(proc);
      await cleanup(entry, 'launch_failed');
      throw error;
    }
  }

  async function closeAll(reason = 'app_closed') {
    const entries = Array.from(processes.values());
    await Promise.all(entries.map(async (entry) => {
      entry.closing = true;
      await killProcessTree(entry.process);
      await cleanup(entry, reason);
    }));
  }

  function running() {
    return Array.from(processes.values()).map((entry) => ({
      clientId: entry.clientId,
      profileId: entry.profile.id,
      pid: entry.process?.pid || null,
      browser: entry.browserKind,
      startedAt: entry.startedAt,
      network: entry.connection?.mode || 'direct',
    }));
  }

  return { launch, close, closeAll, running, profileDir };
}
