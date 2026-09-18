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
  installCredentialAutofill,
  inspectRuntimeProfile,
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

export function resolveKaizenBrowserExecutable(resourcesPath = process.resourcesPath, browserEngine = 'chrome-native') {
  const localApp = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.PROGRAMFILES || '';
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] || '';
  if (browserEngine === 'nstchrome') {
    return existingFile([
      path.join(resourcesPath, 'nstchrome', 'chrome.exe'),
    ]);
  }
  return existingFile([
    path.join(resourcesPath, 'chrome_native', 'chrome.exe'),
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

function runtimeFor(profile) {
  const runtime = profile?.runtime || {};
  const authStrategy = runtime.authStrategy
    || (profile?.sessionMode === 'managed-first-party' ? 'cookie-snapshot' : 'manual');
  return {
    browserEngine: runtime.browserEngine || 'chrome-native',
    authStrategy,
    storageStrategy: runtime.storageStrategy
      || (authStrategy === 'manual' || authStrategy === 'credential-autofill' ? 'local-persistent' : 'portable-first-party'),
    networkStrategy: runtime.networkStrategy || 'auto',
    extensionStrategy: runtime.extensionStrategy || (authStrategy === 'manual' ? 'guard-only' : 'custom'),
  };
}

function snapshotAuthentication(runtime) {
  return runtime.authStrategy === 'cookie-snapshot' || runtime.authStrategy === 'hybrid';
}

function credentialAuthentication(runtime) {
  return runtime.authStrategy === 'credential-autofill' || runtime.authStrategy === 'hybrid';
}

function runtimeKey(runtime) {
  return [
    runtime.browserEngine,
    runtime.authStrategy,
    runtime.storageStrategy,
    runtime.networkStrategy,
    runtime.extensionStrategy,
  ].join('|');
}

function effectiveStoragePolicy(target, requested) {
  const host = String(target?.hostname || '').toLowerCase();
  const netflix = host === 'netflix.com' || host.endsWith('.netflix.com');
  if (netflix && requested !== 'cookies-only') return 'netflix-local-device';
  return requested || 'portable-first-party';
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

  const clientExtensionsDir = (clientId) => path.join(
    app.getPath('userData'),
    'browserExtensionsData',
    safeSegment(clientId, 'client'),
  );
  const profileExtensionDir = (clientId, profileId) => path.join(
    clientExtensionsDir(clientId),
    safeSegment(profileId),
  );

  async function prepareProfileExtension(clientId, profileId, strategy) {
    const source = path.join(process.resourcesPath, 'browser-engine', 'extension');
    const target = profileExtensionDir(clientId, profileId);
    if (!fs.existsSync(path.join(source, 'manifest.json'))) return null;
    await fsp.rm(target, { recursive: true, force: true });
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.cp(source, target, { recursive: true });
    const safeStrategy = ['guard-only', 'main', 'google', 'custom'].includes(strategy) ? strategy : 'guard-only';
    await fsp.writeFile(
      path.join(target, 'strategy.js'),
      `globalThis.USERFLEX_RUNTIME_STRATEGY = ${JSON.stringify(safeStrategy)};\n`,
      'utf8',
    );
    return target;
  }

  async function cleanup(entry, reason = 'closed') {
    if (!entry || entry.cleaned) return;
    entry.cleaned = true;
    if (entry.devtoolsTimer) clearInterval(entry.devtoolsTimer);
    try { await entry.relay?.close(); } catch {}
    if (processes.get(entry.key) === entry) processes.delete(entry.key);
    try { await onClosed?.(entry, reason); } catch (error) {
      log.warn?.('userFLOW KAIZEN onClosed failed:', error?.message || error);
    }
    if (entry.ephemeral === true) {
      await fsp.rm(entry.userDataDir, { recursive: true, force: true }).catch(() => null);
      await fsp.rm(profileExtensionDir(entry.clientId, entry.profile.id), { recursive: true, force: true }).catch(() => null);
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
    credentials = null,
    usageId = null,
    ephemeral = false,
  }) {
    if (!profile?.id || !profile?.url) throw new Error('El perfil no tiene ID o URL.');
    const target = new URL(profile.url);
    if (!['https:', 'http:'].includes(target.protocol)) throw new Error('La URL del perfil no es compatible.');

    const runtime = runtimeFor(profile);
    const snapshotManaged = snapshotAuthentication(runtime);
    const credentialManaged = credentialAuthentication(runtime);
    const credentialHelperEnabled = Boolean(credentials?.username && credentials?.password);
    const desiredSessionVersion = snapshotManaged ? Number(delivery?.version || 0) : 0;
    const desiredCredentialRevision = credentialHelperEnabled ? String(credentials?.updatedAt || '') : '';
    const desiredRuntimeKey = runtimeKey(runtime);
    const key = profileKey(clientId, profile.id);
    const existing = processes.get(key);
    if (existing && existing.process?.exitCode === null) {
      const generationMatches = (!snapshotManaged || Number(existing.sessionVersion || 0) === desiredSessionVersion)
        && String(existing.credentialRevision || '') === desiredCredentialRevision
        && String(existing.runtimeKey || '') === desiredRuntimeKey;
      if (generationMatches) {
        await navigateBrowserHome(existing.debugPort, profile.url).catch(() => null);
        return {
          ok: true,
          reused: true,
          external: true,
          pid: existing.process.pid,
          browser: existing.browserKind,
          sessionVersion: desiredSessionVersion,
          profileState: 'persistent-reuse',
          runtime,
        };
      }
      await close(clientId, profile.id, 'profile_generation_changed');
    }

    const executable = resolveKaizenBrowserExecutable(process.resourcesPath, runtime.browserEngine);
    if (!executable) {
      const message = runtime.browserEngine === 'nstchrome'
        ? 'Este perfil exige nstchrome, pero el runtime nstchrome no está instalado dentro de userFLOW.'
        : 'No se encontró Chrome/Chromium para el motor del perfil. Instala Google Chrome o incluye chrome_native en userFLOW.';
      throw Object.assign(new Error(message), { code: 'KAIZEN_BROWSER_RUNTIME_MISSING' });
    }

    const userDataDir = profileDir(clientId, profile.id);
    await killStrayProfileProcesses(userDataDir);

    let sessionMarker = snapshotManaged ? await readSessionMarker(userDataDir) : null;
    const desiredStoragePolicy = effectiveStoragePolicy(target, runtime.storageStrategy);
    const restorePolicyMatches = !snapshotManaged
      || !sessionMarker
      || sessionMarker?.restore?.storagePolicy === desiredStoragePolicy;
    const sessionVersionMatches = snapshotManaged
      && desiredSessionVersion > 0
      && Number(sessionMarker?.version || 0) === desiredSessionVersion
      && sessionMarker?.profileId === profile.id
      && restorePolicyMatches;

    if (snapshotManaged && !sessionVersionMatches) {
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
    const extensionDir = await prepareProfileExtension(clientId, profile.id, runtime.extensionStrategy);
    const capturedUserAgent = snapshotManaged && typeof delivery?.material?.browser?.userAgent === 'string'
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
      runtime,
      runtimeKey: desiredRuntimeKey,
      credentialRevision: desiredCredentialRevision,
      connection,
      delivery,
      usageId,
      ephemeral: ephemeral === true,
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
        const expectedIp = delivery?.expectedPublicIp || (connection?.locked ? connection?.proxy?.publicIp : null);
        if (expectedIp && detectedIp !== expectedIp) {
          throw new Error(`La IP del navegador no coincide con la configuración. Esperada: ${expectedIp}. Detectada: ${detectedIp}.`);
        }
      }

      let autofill = null;
      if (credentialManaged && !credentialHelperEnabled) {
        throw new Error('El perfil necesita credenciales administradas y el servidor no las entregó.');
      }
      if (credentialHelperEnabled) {
        autofill = await installCredentialAutofill({
          debugPort,
          profileUrl: profile.url,
          credentials,
        });
      }

      let restore = null;
      if (snapshotManaged) {
        if (!delivery?.ready || !delivery?.materialIncluded || !delivery?.material) {
          throw new Error('La sesión capturada del perfil todavía no está lista.');
        }

        if (sessionVersionMatches) {
          await navigateBrowserHome(debugPort, profile.url);
          restore = {
            reusedProfile: true,
            version: desiredSessionVersion,
            format: sessionMarker?.format || delivery.material.format || null,
            storagePolicy: sessionMarker?.restore?.storagePolicy || desiredStoragePolicy,
          };
        } else {
          restore = await restorePortableSession({
            debugPort,
            profileUrl: profile.url,
            profileId: profile.id,
            material: delivery.material,
            storageStrategy: runtime.storageStrategy,
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
        profileState: snapshotManaged
          ? (sessionVersionMatches ? 'persistent-reuse' : 'server-session-restored')
          : credentialHelperEnabled ? 'credential-autofill' : 'persistent-local',
        runtime,
        autofill,
        restore,
      };
    } catch (error) {
      entry.closing = true;
      await killProcessTree(proc);
      await cleanup(entry, 'launch_failed');
      throw error;
    }
  }

  async function inspect(clientId, profileId) {
    const entry = processes.get(profileKey(clientId, profileId));
    if (!entry || entry.process?.exitCode !== null) {
      throw new Error('El navegador de prueba ya no está activo.');
    }
    return inspectRuntimeProfile({
      debugPort: entry.debugPort,
      profileUrl: entry.profile.url,
    });
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
    await fsp.rm(profileExtensionDir(clientId, profileId), { recursive: true, force: true });
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

  async function reconcileCatalogProfiles(clientId, profiles = []) {
    const catalogProfiles = Array.isArray(profiles) ? profiles.filter((profile) => profile?.id) : [];
    const catalogById = new Map(catalogProfiles.map((profile) => [String(profile.id), profile]));
    const authorizedProfileIds = catalogProfiles.map((profile) => String(profile.id));
    const authorization = await reconcileAuthorizedProfiles(clientId, authorizedProfileIds);

    const invalidated = [];
    for (const profile of catalogProfiles) {
      const key = profileKey(clientId, profile.id);
      const runningEntry = processes.get(key);
      const dir = profileDir(clientId, profile.id);
      const marker = runningEntry?.sessionMarker || await readSessionMarker(dir);
      const runtime = runtimeFor(profile);
      const wantsSnapshot = snapshotAuthentication(runtime);
      const wantsCredentials = credentialAuthentication(runtime);
      const optionalCredentialHelper = runtime.authStrategy === 'cookie-snapshot' && Boolean(profile.credentialVersion);
      const tracksCredentialRevision = wantsCredentials || optionalCredentialHelper;
      const desiredVersion = wantsSnapshot ? Number(profile.sessionVersion || 0) : 0;
      const snapshotReady = !wantsSnapshot || (profile.sessionReady === true && desiredVersion > 0);
      const desiredCredentialRevision = tracksCredentialRevision ? String(profile.credentialVersion || '') : '';
      const desiredRuntimeKey = runtimeKey(runtime);

      const runtimeChanged = runningEntry && String(runningEntry.runtimeKey || '') !== desiredRuntimeKey;
      const snapshotChanged = runningEntry && wantsSnapshot && (
        !snapshotReady || Number(runningEntry.sessionVersion || 0) !== desiredVersion
      );
      const credentialsChanged = runningEntry
        && String(runningEntry.credentialRevision || '') !== desiredCredentialRevision;

      if (runningEntry && (runtimeChanged || snapshotChanged || credentialsChanged)) {
        const previousVersion = Number(runningEntry.sessionVersion || marker?.version || 0);
        const reason = runtimeChanged
          ? 'profile_runtime_changed'
          : snapshotChanged
            ? (snapshotReady ? 'session_version_changed' : 'session_revoked')
            : 'credentials_changed';
        await close(clientId, profile.id, reason).catch(() => null);

        // Runtime/auth/storage changes and snapshot generation changes invalidate
        // browser-owned authenticated state. A credentials-only refresh just
        // restarts the process so the persistent local profile remains intact.
        if (runtimeChanged || snapshotChanged) {
          await killStrayProfileProcesses(dir);
          await fsp.rm(dir, { recursive: true, force: true });
        }
        invalidated.push({
          profileId: profile.id,
          from: previousVersion,
          to: snapshotReady ? desiredVersion : 0,
          running: true,
          reason,
        });
        continue;
      }

      if (!runningEntry && marker) {
        const markerVersion = Number(marker.version || 0);
        const markerPolicy = String(marker?.restore?.storagePolicy || '');
        const desiredPolicy = effectiveStoragePolicy(new URL(profile.url), runtime.storageStrategy);
        const markerInvalid = !wantsSnapshot
          || !snapshotReady
          || markerVersion !== desiredVersion
          || markerPolicy !== desiredPolicy;
        if (markerInvalid) {
          await killStrayProfileProcesses(dir);
          await fsp.rm(dir, { recursive: true, force: true });
          invalidated.push({
            profileId: profile.id,
            from: markerVersion,
            to: snapshotReady ? desiredVersion : 0,
            running: false,
            reason: 'stored_generation_changed',
          });
        }
      }
    }

    for (const entry of Array.from(processes.values())) {
      if (safeSegment(entry.clientId, 'client') !== safeSegment(clientId, 'client')) continue;
      if (catalogById.has(String(entry.profile.id))) continue;
      await close(clientId, entry.profile.id, 'profile_revoked').catch(() => null);
    }

    return { removed: authorization.removed || [], invalidated };
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
    await fsp.rm(clientExtensionsDir(clientId), { recursive: true, force: true });
  }

  function running() {
    return Array.from(processes.values()).map((entry) => ({
      clientId: entry.clientId,
      profileId: entry.profile.id,
      pid: entry.process?.pid || null,
      browser: entry.browserKind,
      startedAt: entry.startedAt,
      network: entry.connection?.mode || 'direct',
      sessionVersion: Number(entry.sessionVersion || 0),
    }));
  }

  return {
    launch,
    inspect,
    close,
    closeAll,
    running,
    profileDir,
    reconcileAuthorizedProfiles,
    reconcileCatalogProfiles,
    clearClientProfiles,
  };
}
