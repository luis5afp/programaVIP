import { app, BrowserWindow, safeStorage } from 'electron';
import { RealtimeClient } from '@supabase/realtime-js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createKaizenCaptureEngine } from './browser-engine/kaizen-capture-engine.js';

const API_ORIGIN = 'https://userflex-admin.luis5afp.workers.dev';
const KEEPER_INTERVAL_MS = 3 * 60 * 60 * 1000;
const KEEPER_INITIAL_DELAY_MS = 60 * 1000;
const KEEPER_EVENT_COOLDOWN_MS = 5 * 60 * 1000;
const KEEPER_EVENT_RETRY_MS = 15 * 1000;

let readyWindow = null;
let pendingProtocolUrl = null;
let protocolRegistered = false;
let captureEngine = null;
let activeCaptureToken = null;
let quitAfterCleanup = false;
let keeperTimer = null;
let keeperRunning = false;
let keeperRealtimeClient = null;
let keeperRealtimeChannels = [];
let keeperEventTimer = null;
const keeperRequestedProfiles = new Map();
const keeperLastEventCheck = new Map();

function engine() {
  if (!captureEngine) captureEngine = createKaizenCaptureEngine({ app, log: console });
  return captureEngine;
}

function keeperRegistryPath() {
  return path.join(app.getPath('userData'), 'session-keepers.json');
}

async function loadKeeperRegistry() {
  if (!safeStorage.isEncryptionAvailable()) return {};
  try {
    const raw = JSON.parse(await fs.readFile(keeperRegistryPath(), 'utf8'));
    const entries = raw && typeof raw === 'object' && raw.profiles && typeof raw.profiles === 'object'
      ? raw.profiles
      : {};
    const result = {};
    for (const [profileId, item] of Object.entries(entries)) {
      if (!/^[0-9a-f-]{36}$/i.test(profileId) || typeof item?.token !== 'string') continue;
      try {
        const token = safeStorage.decryptString(Buffer.from(item.token, 'base64'));
        if (/^[A-Za-z0-9_-]{40,64}$/.test(token)) {
          result[profileId] = {
            token,
            name: typeof item.name === 'string' ? item.name : profileId,
            updatedAt: item.updatedAt || null,
          };
        }
      } catch {}
    }
    return result;
  } catch {
    return {};
  }
}

function validKeeperRealtimeConfig(config) {
  try {
    const url = new URL(String(config?.url || ''));
    const key = String(config?.key || '').trim();
    const topic = String(config?.topic || '').trim();
    const event = String(config?.event || 'keeper_check').trim();
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) return null;
    if (!key.startsWith('sb_publishable_') || !topic || !event) return null;
    return { endpoint: `${url.origin}/realtime/v1`, key, topic, event };
  } catch {
    return null;
  }
}

function stopKeeperRealtime() {
  const channels = keeperRealtimeChannels;
  const client = keeperRealtimeClient;
  keeperRealtimeChannels = [];
  keeperRealtimeClient = null;
  for (const channel of channels) void channel.unsubscribe().catch(() => null);
  if (client) {
    try { client.disconnect(); } catch {}
  }
}

function scheduleRequestedKeeperChecks(delayMs = 250) {
  if (keeperEventTimer || quitAfterCleanup) return;
  keeperEventTimer = setTimeout(() => {
    keeperEventTimer = null;
    void runRequestedKeeperChecks();
  }, delayMs);
  keeperEventTimer.unref?.();
}

function queueKeeperCheck(profileId, reason = 'event') {
  if (!/^[0-9a-f-]{36}$/i.test(String(profileId || ''))) return;
  const last = Number(keeperLastEventCheck.get(profileId) || 0);
  const bypassCooldown = reason === 'profile-update' || reason === 'credentials-update';
  if (!bypassCooldown && Date.now() - last < KEEPER_EVENT_COOLDOWN_MS) return;
  keeperRequestedProfiles.set(profileId, reason);
  scheduleRequestedKeeperChecks();
}

async function connectKeeperRealtime() {
  stopKeeperRealtime();
  const registry = await loadKeeperRegistry();
  const entries = Object.entries(registry);
  if (!entries.length || quitAfterCleanup) return;

  const subscriptions = [];
  for (const [profileId, entry] of entries) {
    try {
      const response = await apiPost(API_ORIGIN, '/api/session-keeper/realtime', { token: entry.token }, 20_000);
      const config = validKeeperRealtimeConfig(response?.realtime);
      if (config && String(response?.profileId || '') === profileId) {
        subscriptions.push({ profileId, config });
      }
    } catch (error) {
      if (Number(error?.status || 0) === 401 || ['KEEPER_TOKEN_INVALID', 'INVALID_KEEPER_TOKEN', 'KEEPER_DISABLED'].includes(String(error?.code || ''))) {
        await removeKeeper(profileId);
      } else {
        console.warn(`Session Keeper Realtime no disponible para ${entry?.name || profileId}: ${error?.message || error}`);
      }
    }
  }
  if (!subscriptions.length || quitAfterCleanup) return;

  const first = subscriptions[0].config;
  const client = new RealtimeClient(first.endpoint, {
    params: { apikey: first.key },
    timeout: 10_000,
  });
  keeperRealtimeClient = client;

  for (const subscription of subscriptions) {
    if (subscription.config.endpoint !== first.endpoint || subscription.config.key !== first.key) continue;
    const channel = client.channel(subscription.config.topic, {
      config: {
        broadcast: { ack: false, self: false },
        presence: { enabled: false },
        private: false,
      },
    });
    channel
      .on('broadcast', { event: subscription.config.event }, (message) => {
        const reason = String(message?.payload?.reason || 'event');
        queueKeeperCheck(subscription.profileId, reason);
      })
      .subscribe();
    keeperRealtimeChannels.push(channel);
  }
}

async function saveKeeper(profile, rawToken) {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('Session Keeper no pudo guardar el token porque safeStorage no está disponible.');
    return false;
  }
  if (!profile?.id || !/^[A-Za-z0-9_-]{40,64}$/.test(String(rawToken || ''))) return false;
  const file = keeperRegistryPath();
  let current = { profiles: {} };
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.profiles && typeof parsed.profiles === 'object') current = parsed;
  } catch {}
  current.profiles[profile.id] = {
    token: safeStorage.encryptString(String(rawToken)).toString('base64'),
    name: profile.name || profile.id,
    updatedAt: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(current), { encoding: 'utf8', mode: 0o600 });
  return true;
}

async function removeKeeper(profileId) {
  const file = keeperRegistryPath();
  try {
    const current = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!current?.profiles || typeof current.profiles !== 'object') return;
    delete current.profiles[profileId];
    await fs.writeFile(file, JSON.stringify(current), { encoding: 'utf8', mode: 0o600 });
    if (Object.keys(current.profiles).length === 0) configureKeeperStartup(false);
  } catch {}
}

function keeperNeedsLoginMessage(inspection) {
  if (!inspection) return 'No se pudo confirmar que la web continúe autenticada.';
  if (inspection.loginLikeUrl) return `La web redirigió a inicio de sesión: ${inspection.href || ''}`;
  if (inspection.passwordFieldVisible) return 'La web está mostrando un campo de contraseña.';
  if (inspection.usernameFieldVisible) return 'La web está mostrando un campo de usuario/correo.';
  if (inspection.loginActionVisible) return 'La web está mostrando una acción de inicio de sesión.';
  return 'La web ya no parece autenticada.';
}

async function checkKeeperProfile(profileId, entry) {
  const token = entry?.token;
  if (!token) return;
  const bootstrap = await apiPost(API_ORIGIN, '/api/session-keeper/bootstrap', { token }, 45_000);
  const profile = bootstrap.profile;
  const credentials = bootstrap.credentials || null;
  const proxy = bootstrap.proxy || null;
  if (!profile?.id || profile.id !== profileId || !profile?.url) {
    throw new Error('Session Keeper recibió una configuración de perfil inválida.');
  }

  try {
    await engine().launch({
      profile,
      credentials,
      proxy,
      background: true,
      onComplete: async ({ material, publicIp, diagnostics }) => {
        const completed = await apiPost(API_ORIGIN, '/api/session-keeper/complete', {
          token,
          authenticated: true,
          publicIp,
          material,
        }, 90_000);
        console.log(
          `Session Keeper refreshed ${profile.name || profile.id} v${completed.version}: `
          + `${diagnostics.cookieCount} cookies, ${diagnostics.indexedDbCount} IndexedDB databases.`,
        );
        return {
          version: completed.version,
          publicIp: completed.public_ip || publicIp || null,
        };
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 4500));
    let inspection = await engine().inspectActive().catch(() => null);
    if (!inspection?.authenticated && profile.authStrategy === 'hybrid' && credentials?.username && credentials?.password) {
      // Give the managed autofill a short window to recover sessions that only
      // need the stored account identifier/password. 2FA/CAPTCHA still requires
      // the administrator and will never overwrite the last good snapshot.
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      inspection = await engine().inspectActive().catch(() => inspection);
    }

    if (!inspection?.authenticated) {
      const reason = keeperNeedsLoginMessage(inspection);
      await apiPost(API_ORIGIN, '/api/session-keeper/complete', {
        token,
        authenticated: false,
        error: reason,
      }, 30_000).catch(() => null);
      console.warn(`Session Keeper requires administrator for ${profile.name || profile.id}: ${reason}`);
      return;
    }

    await engine().saveActive();
  } finally {
    await engine().close('keeper_check').catch(() => null);
  }
}

async function runRequestedKeeperChecks() {
  if (keeperRunning || engine().active || quitAfterCleanup) {
    if (keeperRequestedProfiles.size) scheduleRequestedKeeperChecks(KEEPER_EVENT_RETRY_MS);
    return;
  }
  if (!keeperRequestedProfiles.size) return;

  keeperRunning = true;
  try {
    const registry = await loadKeeperRegistry();
    while (keeperRequestedProfiles.size && !quitAfterCleanup) {
      const [profileId, reason] = keeperRequestedProfiles.entries().next().value || [];
      if (!profileId) break;
      keeperRequestedProfiles.delete(profileId);
      const entry = registry[profileId];
      if (!entry) continue;
      try {
        keeperLastEventCheck.set(profileId, Date.now());
        console.log(`Session Keeper event check ${entry?.name || profileId}: ${reason || 'event'}`);
        await checkKeeperProfile(profileId, entry);
      } catch (error) {
        console.warn(
          `Session Keeper event check failed for ${entry?.name || profileId}: `
          + `${error instanceof Error ? error.message : String(error || 'error')}`,
        );
        if (Number(error?.status || 0) === 401 || ['KEEPER_TOKEN_INVALID', 'INVALID_KEEPER_TOKEN', 'KEEPER_DISABLED'].includes(String(error?.code || ''))) {
          await removeKeeper(profileId);
        }
        await engine().close('keeper_event_error').catch(() => null);
      }
    }
  } finally {
    keeperRunning = false;
    if (keeperRequestedProfiles.size) scheduleRequestedKeeperChecks(KEEPER_EVENT_RETRY_MS);
  }
}

async function runKeeperCycle() {
  if (keeperRunning) return;
  if (engine().active) {
    console.log('Session Keeper pospuesto porque hay una captura manual activa.');
    return;
  }
  keeperRunning = true;
  try {
    const registry = await loadKeeperRegistry();
    for (const [profileId, entry] of Object.entries(registry)) {
      if (quitAfterCleanup) break;
      try {
        await checkKeeperProfile(profileId, entry);
      } catch (error) {
        console.warn(
          `Session Keeper check failed for ${entry?.name || profileId}: `
          + `${error instanceof Error ? error.message : String(error || 'error')}`,
        );
        if (Number(error?.status || 0) === 401 || ['KEEPER_TOKEN_INVALID', 'INVALID_KEEPER_TOKEN'].includes(String(error?.code || ''))) {
          await removeKeeper(profileId);
        }
        await engine().close('keeper_error').catch(() => null);
      }
    }
  } finally {
    keeperRunning = false;
    if (keeperRequestedProfiles.size) scheduleRequestedKeeperChecks();
  }
}

function scheduleKeeper() {
  if (keeperTimer) clearTimeout(keeperTimer);
  keeperTimer = setTimeout(() => {
    keeperTimer = null;
    void runKeeperCycle().finally(() => {
      if (!quitAfterCleanup) {
        keeperTimer = setTimeout(() => void scheduleKeeper(), KEEPER_INTERVAL_MS);
        keeperTimer.unref?.();
      }
    });
  }, KEEPER_INITIAL_DELAY_MS);
  keeperTimer.unref?.();
}

function configureKeeperStartup(enabled = true) {
  if (process.platform !== 'win32' || process.defaultApp) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled === true,
      openAsHidden: enabled === true,
      args: enabled === true ? ['--keeper'] : [],
    });
  } catch {}
}

function protocolUrlFromArgs(args) {
  return args.find((arg) => typeof arg === 'string' && arg.startsWith('userflex-session://')) || null;
}

function registerProtocol() {
  try {
    const registered = process.defaultApp && process.argv.length >= 2
      ? app.setAsDefaultProtocolClient('userflex-session', process.execPath, [path.resolve(process.argv[1])])
      : app.setAsDefaultProtocolClient('userflex-session');
    return registered || app.isDefaultProtocolClient('userflex-session');
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function showReadyWindow(message = null) {
  if (readyWindow && !readyWindow.isDestroyed()) {
    readyWindow.show();
    readyWindow.focus();
    return;
  }

  const status = message || (protocolRegistered
    ? 'El protocolo userflex-session:// está registrado. El motor KAIZEN está listo.'
    : 'Windows no confirmó el protocolo. Reinstala Session Manager si Cargar sesión no abre el navegador.');
  const tone = protocolRegistered ? '#166534' : '#9a3412';
  const background = protocolRegistered ? '#f0fdf4' : '#fff7ed';
  const html = `<!doctype html><meta charset="utf-8"><title>userFLEX Session Manager</title>
  <body style="margin:0;background:#f8fafc;font-family:system-ui;color:#0f172a">
    <main style="max-width:680px;margin:52px auto;padding:0 24px">
      <div style="background:white;border:1px solid #e2e8f0;border-radius:18px;padding:28px;box-shadow:0 16px 45px rgba(15,23,42,.08)">
        <h2 style="margin:0 0 10px">userFLEX Session Manager · Motor KAIZEN</h2>
        <p style="color:#475569;line-height:1.55">La captura ya no usa una ventana Electron para navegar. userFLEX abre un Chrome/Edge nativo con perfil persistente y aislado.</p>
        <div style="margin:18px 0;padding:12px 14px;border-radius:12px;background:${background};color:${tone};font-weight:700">${escapeHtml(status)}</div>
        <ol style="color:#475569;line-height:1.7;padding-left:20px">
          <li>Vuelve al panel userFLEX.</li>
          <li>Pulsa <b>Cargar sesión</b> en el perfil.</li>
          <li>Se abrirá el navegador externo con el perfil aislado.</li>
          <li>Completa el acceso y pulsa <b>Guardar sesión</b> en el recuadro userFLEX.</li>
        </ol>
        <p style="margin-bottom:0;color:#64748b;font-size:13px">La nueva captura incluye cookies, Local Storage, Session Storage e IndexedDB y se envía cifrada al servidor userFLEX.</p>
      </div>
    </main>
  </body>`;

  readyWindow = new BrowserWindow({
    width: 760,
    height: 560,
    minWidth: 640,
    minHeight: 440,
    title: 'userFLEX Session Manager',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
    },
  });
  readyWindow.on('closed', () => { readyWindow = null; });
  void readyWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

async function apiPost(endpoint, pathName, body, timeoutMs = 45_000) {
  const response = await fetch(`${endpoint}${pathName}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Userflex-Session-Manager-Version': app.getVersion(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { error: text };
  }
  if (!response.ok) {
    const error = new Error(payload?.error || payload?.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload?.code || 'HTTP_ERROR';
    throw error;
  }
  return payload;
}

function assertSessionProtocolUrl(rawUrl, action) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'userflex-session:' || url.hostname !== action) {
    throw new Error(action === 'save' ? 'Enlace de guardado inválido.' : 'Enlace de captura inválido.');
  }
  const endpoint = url.searchParams.get('endpoint') || '';
  const token = url.searchParams.get('token') || '';
  const endpointUrl = new URL(endpoint);
  if (endpointUrl.origin !== API_ORIGIN) {
    throw new Error('El enlace no pertenece al servidor oficial de userFLEX.');
  }
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) throw new Error('Token de captura inválido.');
  return { endpoint: API_ORIGIN, token };
}

function sameCaptureToken(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

async function startCapture(rawUrl) {
  const { endpoint, token } = assertSessionProtocolUrl(rawUrl, 'capture');
  const bootstrap = await apiPost(endpoint, '/api/session-manager/bootstrap', { token });
  const profile = bootstrap.profile;
  const credentials = bootstrap.credentials;
  const proxy = bootstrap.proxy || null;

  if (!profile?.id || !profile?.url) {
    throw new Error('La configuración de captura está incompleta.');
  }
  if (profile.authStrategy === 'hybrid' && (!credentials?.username || !credentials?.password)) {
    throw new Error('El perfil híbrido necesita credenciales para la captura.');
  }

  if (readyWindow && !readyWindow.isDestroyed()) readyWindow.close();

  const result = await engine().launch({
    profile,
    credentials,
    proxy,
    onComplete: async ({ material, publicIp, diagnostics }) => {
      const completed = await apiPost(endpoint, '/api/session-manager/complete', {
        token,
        publicIp,
        material,
      }, 90_000);
      if (completed?.keeper_token) {
        await saveKeeper(profile, completed.keeper_token);
        configureKeeperStartup();
        scheduleKeeper();
        void connectKeeperRealtime();
      }
      if (sameCaptureToken(activeCaptureToken, token)) activeCaptureToken = null;
      console.log(
        `Session Manager KAIZEN saved profile ${profile.id} v${completed.version}: `
        + `${diagnostics.cookieCount} cookies, ${diagnostics.indexedDbCount} IndexedDB databases.`,
      );
      return {
        version: completed.version,
        publicIp: completed.public_ip || publicIp || null,
      };
    },
  });

  activeCaptureToken = token;
  console.log(
    `Session Manager KAIZEN launched ${profile.name || profile.id} `
    + `pid=${result.pid} debugPort=${result.debugPort} `
    + `network=${proxy ? 'proxy' : 'direct'}.`,
  );
  return result;
}

async function saveActiveCapture(rawUrl) {
  const { token } = assertSessionProtocolUrl(rawUrl, 'save');
  if (!sameCaptureToken(activeCaptureToken, token)) {
    throw new Error('Este botón Guardar sesión ya no corresponde a la captura activa. Genera una captura nueva desde el Administrador.');
  }
  const result = await engine().saveActive();
  activeCaptureToken = null;
  console.log(
    `Session Manager KAIZEN saved active capture v${result.version || '?'}: `
    + `${result.cookieCount || 0} cookies, ${result.indexedDbCount || 0} IndexedDB databases.`,
  );
  return result;
}

async function handleProtocolUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'userflex-session:') throw new Error('Enlace de Session Manager inválido.');
  if (url.hostname === 'capture') return startCapture(rawUrl);
  if (url.hostname === 'save') return saveActiveCapture(rawUrl);
  throw new Error('Acción de Session Manager no compatible.');
}

function showFatalError(error) {
  const message = error instanceof Error ? error.message : String(error || 'Error inesperado.');
  const html = `<!doctype html><meta charset="utf-8"><title>userFLEX</title>
    <body style="font-family:system-ui;padding:28px;color:#0f172a">
      <h2>No se pudo abrir el perfil</h2>
      <p>${escapeHtml(message)}</p>
      <p style="color:#64748b">Cierra esta ventana, corrige el problema indicado y vuelve a pulsar Cargar sesión en el panel.</p>
    </body>`;
  const win = new BrowserWindow({
    width: 720,
    height: 360,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false },
  });
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const protocolUrl = protocolUrlFromArgs(argv);
    if (protocolUrl) {
      void handleProtocolUrl(protocolUrl).catch(showFatalError);
      return;
    }
    showReadyWindow();
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (!app.isReady()) pendingProtocolUrl = url;
    else void handleProtocolUrl(url).catch(showFatalError);
  });

  app.whenReady().then(async () => {
    protocolRegistered = registerProtocol();
    const keepers = await loadKeeperRegistry();
    const hasKeepers = Object.keys(keepers).length > 0;
    configureKeeperStartup(hasKeepers);
    if (hasKeepers) {
      scheduleKeeper();
      void connectKeeperRealtime();
    }
    const protocolUrl = pendingProtocolUrl || protocolUrlFromArgs(process.argv);
    const keeperOnly = process.argv.includes('--keeper') && !protocolUrl;
    pendingProtocolUrl = null;
    if (protocolUrl) await handleProtocolUrl(protocolUrl).catch(showFatalError);
    else if (!keeperOnly) showReadyWindow();
  });

  app.on('activate', () => {
    if (!engine().active) showReadyWindow();
  });

  app.on('before-quit', (event) => {
    if (quitAfterCleanup) return;
    event.preventDefault();
    quitAfterCleanup = true;
    if (keeperTimer) clearTimeout(keeperTimer);
    keeperTimer = null;
    if (keeperEventTimer) clearTimeout(keeperEventTimer);
    keeperEventTimer = null;
    stopKeeperRealtime();
    void engine().close('app_exit')
      .catch(() => null)
      .finally(() => app.quit());
  });
}
