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

function sessionMarkerPath(userDataDir) {
  return path.join(userDataDir, '.userflex-session.json');
}

async function readSessionMarker(userDataDir) {
  try {
    const value = JSON.parse(await fsp.readFile(sessionMarkerPath(userDataDir), 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

async function writeSessionMarker(userDataDir, profile, delivery, restore) {
  const marker = {
    profileId: profile.id,
    version: Number(delivery?.version || 0),
    format: delivery?.material?.format || null,
    capturedAt: delivery?.capturedAt || null,
    restoredAt: new Date().toISOString(),
    restore: restore || null,
  };
  await fsp.writeFile(sessionMarkerPath(userDataDir), JSON.stringify(marker, null, 2), 'utf8');
  return marker;
}

async function resetProfileDirectory(userDataDir) {
  await fsp.rm(userDataDir, { recursive: true, force: true });
  await fsp.mkdir(userDataDir, { recursive: true });
}

function chromeArgs({ userDataDir, debugPort, proxyRules, extensionDir, userAgent = null }) {
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
    '--disable-background-networking',
    '--disable-client-side-phishing-detection',
    '--disable-default-apps',
    '--disable-domain-reliability',
    '--disable-popup-blocking',
  ];
  if (userAgent && typeof userAgent === 'string' && userAgent.length <= 600 && !/[\r\n]/.test(userAgent)) {
    args.push(`--user-agent=${userAgent}`);
  }
  if (proxyRules) args.push(`--proxy-server=${proxyRules}`, '--proxy-bypass-list=<-loopback>');
  if (extensionDir && fs.existsSync(path.join(extensionDir, 'manifest.json'))) {
    args.push(`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`);
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
  const escaped = userDataDir.replace(/'/g, "''");
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
  const clientProfilesDir = (clientId) => path.join(
    app.getPath('userData'),
    'browserProfilesData',
    safeSegment(clientId, 'client'),
  );
  const profileDir = (clientId, profileId) => path.join(
    clientProfilesDir(clientId),
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
    const managed = profile.sessionMode === 'managed-first-party';
    const desiredSessionVersion = managed ? Number(delivery?.version || 0) : 0;
    const existing = processes.get(key);
    if (existing && existing.process?.exitCode === null) {
      const versionMatches = !managed || Number(existing.sessionVersion || 0) === desiredSessionVersion;
      if (versionMatches) {
        await navigateBrowserHome(existing.debugPort, profile.url).catch(() => null);
        return {
          ok: true,
          reused: true,
          external: true,
          pid: existing.process.pid,
          browser: existing.browserKind,
          sessionVersion: desiredSessionVersion,
          profileState: 'persistent-reuse',
        };
      }

      // KAIZEN-style profile synchronization: a newer server session must never
      // keep running inside the old local browser process.
      await close(clientId, profile.id, 'session_version_changed');
    }

    const executable = resolveKaizenBrowserExecutable();
    if (!executable) {
      throw Object.assign(
        new Error('No se encontró Chrome/Chromium para el motor de perfiles. Instala Google Chrome o incluye chrome_native en userFLOW.'),
        { code: 'KAIZEN_BROWSER_RUNTIME_MISSING' },
      );
    }

    const userDataDir = profileDir(clientId, profile.id);
    await killStrayProfileProcesses(userDataDir);

    let sessionMarker = managed ? await readSessionMarker(userDataDir) : null;
    const sessionVersionMatches = managed
      && desiredSessionVersion > 0
      && Number(sessionMarker?.version || 0) === desiredSessionVersion
      && sessionMarker?.profileId === profile.id;

    if (managed && !sessionVersionMatches) {
      // The server is authoritative. Remove stale Chromium state before applying
      // a new managed-session generation so old cookies/IDB/service state cannot
      // leak into the freshly delivered version.
      await resetProfileDirectory(userDataDir);
      sessionMarker = null;
    } else {
      await fsp.mkdir(userDataDir, { recursive: true });
    }

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
    const capturedUserAgent = managed && typeof delivery?.material?.browser?.userAgent === 'string'
      ? delivery.material.browser.userAgent
      : null;
    const args = chromeArgs({ userDataDir, debugPort, proxyRules, extensionDir, userAgent: capturedUserAgent });
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
      sessionVersion: desiredSessionVersion,
      sessionMarker,
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
      if (managed) {
        if (!delivery?.ready || !delivery?.materialIncluded || !delivery?.material) {
          throw new Error('La sesión administrada todavía no está lista.');
        }

        if (sessionVersionMatches) {
          // Keep the entire local Chromium profile intact when the server
          // generation is unchanged. This is the core KAIZEN profile behavior:
          // browser-owned state continues naturally between launches.
          await navigateBrowserHome(debugPort, profile.url);
          restore = {
            reusedProfile: true,
            version: desiredSessionVersion,
            format: sessionMarker?.format || delivery.material.format || null,
          };
        } else {
          restore = await restorePortableSession({
            debugPort,
            profileUrl: profile.url,
            profileId: profile.id,
            material: delivery.material,
          });
          sessionMarker = await writeSessionMarker(userDataDir, profile, delivery, restore);
          entry.sessionMarker = sessionMarker;
        }
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
        sessionVersion: desiredSessionVersion,
        profileState: managed ? (sessionVersionMatches ? 'persistent-reuse' : 'server-session-restored') : 'persistent-local',
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

  async function removeLocalProfile(clientId, profileId, reason = 'profile_revoked') {
    await close(clientId, profileId, reason).catch(() => null);
    const dir = profileDir(clientId, profileId);
    await killStrayProfileProcesses(dir);
    await fsp.rm(dir, { recursive: true, force: true });
  }

  async function reconcileAuthorizedProfiles(clientId, profileIds = []) {
    const allowed = new Set(
      profileIds
        .map((value) => String(value || '').trim())
        .filter((value) => /^[0-9a-f-]{36}$/i.test(value))
        .map((value) => safeSegment(value)),
    );
    const root = clientProfilesDir(clientId);
    let entries = [];
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch {
      return { removed: [] };
    }

    const removed = [];
    for (const item of entries) {
      if (!item.isDirectory() || allowed.has(item.name)) continue;
      await removeLocalProfile(clientId, item.name, 'profile_revoked');
      removed.push(item.name);
    }
    return { removed };
  }

  async function clearClientProfiles(clientId, reason = 'client_logout') {
    const keyPrefix = `${safeSegment(clientId, 'client')}:`;
    const live = Array.from(processes.entries())
      .filter(([key]) => key.startsWith(keyPrefix))
      .map(([, entry]) => entry);
    await Promise.all(live.map(async (entry) => {
      entry.closing = true;
      await killProcessTree(entry.process);
      await cleanup(entry, reason);
    }));

    const root = clientProfilesDir(clientId);
    try {
      const entries = await fsp.readdir(root, { withFileTypes: true });
      for (const item of entries) {
        if (!item.isDirectory()) continue;
        await killStrayProfileProcesses(path.join(root, item.name));
      }
    } catch {}
    await fsp.rm(root, { recursive: true, force: true });
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

  return {
    launch,
    close,
    closeAll,
    running,
    profileDir,
    reconcileAuthorizedProfiles,
    clearClientProfiles,
  };
}
