import { app, BrowserWindow, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createKaizenCaptureEngine } from './browser-engine/kaizen-capture-engine.js';

const API_ORIGIN = 'https://userflex-admin.luis5afp.workers.dev';
const KEEPER_TARGET_ROUND_MS = 8 * 60 * 60 * 1000;
const KEEPER_MIN_INTERVAL_MS = 20 * 60 * 1000;
const KEEPER_MAX_INTERVAL_MS = 3 * 60 * 60 * 1000;
const KEEPER_INITIAL_DELAY_MS = 2 * 60 * 1000;

let readyWindow = null;
let pendingProtocolUrl = null;
let protocolRegistered = false;
let captureEngine = null;
let activeCaptureToken = null;
let captureStartState = null;
let lastCompletedCapture = null;
let quitAfterCleanup = false;
let keeperTimer = null;
let keeperRunning = false;
let manualCaptureGeneration = 0;

function engine() {
  if (!captureEngine) captureEngine = createKaizenCaptureEngine({ app, log: console });
  return captureEngine;
}

function manualCaptureBusy() {
  return Boolean(activeCaptureToken || captureStartState);
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
            lastCheckAt: item.lastCheckAt || null,
          };
        }
      } catch {}
    }
    return result;
  } catch {
    return {};
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
  const previous = current.profiles[profile.id] || {};
  current.profiles[profile.id] = {
    token: safeStorage.encryptString(String(rawToken)).toString('base64'),
    name: profile.name || profile.id,
    updatedAt: new Date().toISOString(),
    lastCheckAt: previous.lastCheckAt || null,
  };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(current), { encoding: 'utf8', mode: 0o600 });
  return true;
}

async function markKeeperChecked(profileId) {
  const file = keeperRegistryPath();
  try {
    const current = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!current?.profiles?.[profileId]) return;
    current.profiles[profileId].lastCheckAt = new Date().toISOString();
    await fs.writeFile(file, JSON.stringify(current), { encoding: 'utf8', mode: 0o600 });
  } catch {}
}

function keeperIntervalForCount(count) {
  const safeCount = Math.max(1, Number(count || 0));
  return Math.max(
    KEEPER_MIN_INTERVAL_MS,
    Math.min(KEEPER_MAX_INTERVAL_MS, Math.floor(KEEPER_TARGET_ROUND_MS / safeCount)),
  );
}

function strongKeeperLoginEvidence(inspection) {
  if (!inspection) return false;
  if (inspection.loginLikeUrl === true) return true;
  if (inspection.passwordFieldVisible === true) return true;
  if (inspection.loginActionVisible === true) return true;
  if (inspection.netflixTarget && inspection.netflixAuthCookies === false && inspection.netflixAppPath === false) return true;
  return false;
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
  if (inspection.netflixTarget && inspection.netflixAuthCookies === false) {
    return 'Netflix ya no conserva NetflixId y SecureNetflixId en el perfil local.';
  }
  if (inspection.netflixTarget && inspection.netflixAppPath === false) {
    return `Netflix no abrió el área autenticada (/browse). URL actual: ${inspection.href || ''}`;
  }
  if (inspection.passwordFieldVisible) return 'La web está mostrando un campo de contraseña.';
  if (inspection.usernameFieldVisible) return 'La web está mostrando un campo de usuario/correo.';
  if (inspection.loginActionVisible) return 'La web está mostrando una acción de inicio de sesión.';
  return 'La web ya no parece autenticada.';
}

async function checkKeeperProfile(profileId, entry) {
  const token = entry?.token;
  if (!token) return;

  const manualGenerationAtStart = manualCaptureGeneration;
  const interruptedByManualCapture = () => (
    manualCaptureGeneration !== manualGenerationAtStart || manualCaptureBusy()
  );

  const bootstrap = await apiPost(API_ORIGIN, '/api/session-keeper/bootstrap', { token }, 45_000);
  if (interruptedByManualCapture()) return;

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
        if (interruptedByManualCapture()) {
          throw new Error('Session Keeper interrumpido por una renovación manual.');
        }
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

    if (interruptedByManualCapture()) return;
    await new Promise((resolve) => setTimeout(resolve, 4500));
    if (interruptedByManualCapture()) return;

    let inspection = await engine().inspectActive().catch(() => null);
    if (!inspection?.authenticated && profile.authStrategy === 'hybrid' && credentials?.username && credentials?.password) {
      // Give autofill a short window to recover a session that only needs the
      // stored credentials. 2FA/CAPTCHA still requires the administrator.
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      if (interruptedByManualCapture()) return;
      inspection = await engine().inspectActive().catch(() => inspection);
    }

    const failedInspections = [];
    if (!inspection?.authenticated) failedInspections.push(inspection);
    for (let attempt = 0; attempt < 2 && !inspection?.authenticated; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      if (interruptedByManualCapture()) return;
      inspection = await engine().inspectActive().catch(() => null);
      if (!inspection?.authenticated) failedInspections.push(inspection);
    }

    if (interruptedByManualCapture()) return;
    if (!inspection?.authenticated) {
      const confirmedLoginLoss = failedInspections.length >= 3
        && failedInspections.every((item) => strongKeeperLoginEvidence(item));
      if (!confirmedLoginLoss) {
        throw new Error('Session Keeper no pudo confirmar el estado de acceso; se conserva la última sesión válida y se intentará de nuevo.');
      }
      const reason = keeperNeedsLoginMessage(failedInspections[failedInspections.length - 1]);
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
    // A manual renewal may have replaced the Keeper browser while this async
    // check was waiting. Never let a stale Keeper finally() close the user's
    // newly-opened manual capture.
    if (!interruptedByManualCapture()) {
      await engine().close('keeper_check').catch(() => null);
    }
  }
}

async function runKeeperCycle() {
  if (keeperRunning) return;
  if (manualCaptureBusy() || engine().active) {
    console.log('Session Keeper pospuesto porque hay una captura manual activa.');
    return;
  }

  keeperRunning = true;
  try {
    const registry = await loadKeeperRegistry();
    const entries = Object.entries(registry);
    if (!entries.length || quitAfterCleanup || manualCaptureBusy()) return;

    // Check exactly one profile at a time to keep CPU/server usage low, but
    // choose the least-recently checked profile so app restarts cannot starve
    // profiles that happen to be later in the registry.
    entries.sort((left, right) => {
      const leftAt = Date.parse(left[1]?.lastCheckAt || left[1]?.updatedAt || '') || 0;
      const rightAt = Date.parse(right[1]?.lastCheckAt || right[1]?.updatedAt || '') || 0;
      return leftAt - rightAt;
    });
    const [profileId, entry] = entries[0];
    let removed = false;

    try {
      await checkKeeperProfile(profileId, entry);
    } catch (error) {
      console.warn(
        `Session Keeper check failed for ${entry?.name || profileId}: `
        + `${error instanceof Error ? error.message : String(error || 'error')}`,
      );
      if (Number(error?.status || 0) === 401 || ['KEEPER_TOKEN_INVALID', 'INVALID_KEEPER_TOKEN'].includes(String(error?.code || ''))) {
        removed = true;
        await removeKeeper(profileId);
      }
      if (!manualCaptureBusy()) {
        await engine().close('keeper_error').catch(() => null);
      }
    } finally {
      if (!removed) await markKeeperChecked(profileId);
    }
  } finally {
    keeperRunning = false;
  }
}

function scheduleKeeper(delayMs = KEEPER_INITIAL_DELAY_MS) {
  if (keeperTimer) clearTimeout(keeperTimer);
  keeperTimer = setTimeout(() => {
    keeperTimer = null;
    void runKeeperCycle().finally(async () => {
      if (quitAfterCleanup) return;
      const registry = await loadKeeperRegistry();
      scheduleKeeper(keeperIntervalForCount(Object.keys(registry).length));
    });
  }, delayMs);
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
          <li>Completa el acceso. userFLEX guardará automáticamente; si Chromium no se cierra, pulsa <b>Guardar ahora</b>.</li>
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
  const operationId = (() => {
    try { return crypto.randomUUID(); } catch { return `sm-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  })();

  let response;
  try {
    response = await fetch(`${endpoint}${pathName}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Userflex-Session-Manager-Version': app.getVersion(),
        'X-Userflex-Request-Id': operationId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    const error = new Error(cause?.name === 'TimeoutError'
      ? 'El servidor tardó demasiado en responder.'
      : `No se pudo conectar con userFLEX: ${cause?.message || 'error de red'}`);
    error.code = cause?.name === 'TimeoutError' ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR';
    error.requestId = operationId;
    throw error;
  }

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
    error.requestId = response.headers.get('X-Userflex-Request-Id') || payload?.requestId || operationId;
    throw error;
  }
  return payload;
}

function assertSessionProtocolUrl(rawUrl, action) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'userflex-session:' || url.hostname !== action) {
    const label = action === 'save' ? 'guardado' : action === 'guest' ? 'invitado' : 'captura';
    throw new Error(`Enlace de ${label} inválido.`);
  }
  const endpoint = url.searchParams.get('endpoint') || '';
  const token = url.searchParams.get('token') || '';
  const endpointUrl = new URL(endpoint);
  if (endpointUrl.origin !== API_ORIGIN) {
    throw new Error('El enlace no pertenece al servidor oficial de userFLEX.');
  }
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) {
    throw new Error(action === 'guest' ? 'Token de invitado inválido.' : 'Token de captura inválido.');
  }
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

async function startGuest(rawUrl) {
  const { endpoint, token } = assertSessionProtocolUrl(rawUrl, 'guest');

  // Guest is a manual action and therefore takes priority over any automatic
  // Keeper activity. It never loads or saves the managed snapshot.
  manualCaptureGeneration += 1;
  if (engine().active) {
    await engine().close('manual_guest_priority').catch(() => null);
  }

  const bootstrap = await apiPost(endpoint, '/api/session-manager/guest-bootstrap', { token });
  const profile = bootstrap.profile;
  const proxy = bootstrap.proxy || null;
  if (!profile?.id || !profile?.url) {
    throw new Error('La configuración de invitado está incompleta.');
  }

  if (readyWindow && !readyWindow.isDestroyed()) readyWindow.close();

  const result = await engine().launchGuest({ profile, proxy });
  console.log(
    `Session Manager Guest launched ${profile.name || profile.id} `
    + `pid=${result.pid} network=${proxy ? 'proxy' : 'direct'}.`,
  );
  return result;
}

async function startCapture(rawUrl) {
  const { endpoint, token } = assertSessionProtocolUrl(rawUrl, 'capture');

  // Manual renewal always wins over background Keeper activity. The generation
  // also lets an older Keeper task detect that it no longer owns the browser.
  manualCaptureGeneration += 1;

  // Mark the ticket before any network/browser work starts. The Admin can send
  // the Save protocol almost immediately after the Capture protocol and both
  // arrive as separate Windows protocol activations.
  activeCaptureToken = token;

  const launchPromise = (async () => {
    if (keeperRunning && engine().active) {
      await engine().close('manual_capture_priority').catch(() => null);
    }
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
      onComplete: async ({ material, publicIp, diagnostics, authenticated }) => {
        const completed = await apiPost(endpoint, '/api/session-manager/complete', {
          token,
          publicIp,
          material,
          authenticated: authenticated === true,
        }, 90_000);
        if (completed?.keeper_token) {
          // Validation is one-time. Keep the server-side record for backward
          // compatibility, but do not schedule periodic revalidation.
          configureKeeperStartup(false);
        }

        const completedResult = {
          ok: true,
          version: completed.version,
          publicIp: completed.public_ip || publicIp || null,
          cookieCount: Number(diagnostics.cookieCount || 0),
          indexedDbCount: Number(diagnostics.indexedDbCount || 0),
          indexedDbBytes: Number(diagnostics.indexedDbBytes || 0),
          authenticated: authenticated === true,
          validated: completed?.validated === true,
        };
        lastCompletedCapture = {
          token,
          completedAt: Date.now(),
          result: completedResult,
        };
        if (sameCaptureToken(activeCaptureToken, token)) activeCaptureToken = null;

        console.log(
          `Session Manager KAIZEN saved profile ${profile.id} v${completed.version}: `
          + `${diagnostics.cookieCount} cookies, ${diagnostics.indexedDbCount} IndexedDB databases.`,
        );
        return {
          version: completed.version,
          publicIp: completedResult.publicIp,
        };
      },
    });

    console.log(
      `Session Manager KAIZEN launched ${profile.name || profile.id} `
      + `pid=${result.pid} debugPort=${result.debugPort} `
      + `network=${proxy ? 'proxy' : 'direct'}.`,
    );
    return result;
  })();

  captureStartState = { token, promise: launchPromise };

  try {
    return await launchPromise;
  } catch (error) {
    if (sameCaptureToken(activeCaptureToken, token)) activeCaptureToken = null;
    throw error;
  } finally {
    if (captureStartState?.promise === launchPromise) captureStartState = null;
  }
}

async function waitForCaptureStart(token, timeoutMs = 25_000) {
  const state = captureStartState;
  if (!state || !sameCaptureToken(state.token, token)) return;
  let timeout = null;
  try {
    await Promise.race([
      state.promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Chromium todavía está iniciando. Espera unos segundos y vuelve a guardar.')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function completedCaptureFor(token) {
  if (!lastCompletedCapture || !sameCaptureToken(lastCompletedCapture.token, token)) return null;
  if (Date.now() - Number(lastCompletedCapture.completedAt || 0) > 15 * 60 * 1000) return null;
  return lastCompletedCapture.result || null;
}

async function saveActiveCapture(rawUrl) {
  const { token } = assertSessionProtocolUrl(rawUrl, 'save');

  // Saving from the Chromium overlay and then from the Admin should be
  // idempotent. Return the already-created snapshot instead of opening an
  // alarming stale-ticket error window.
  const alreadyCompleted = completedCaptureFor(token);
  if (alreadyCompleted) return alreadyCompleted;

  if (sameCaptureToken(activeCaptureToken, token)) {
    await waitForCaptureStart(token);
  }

  const completedAfterWait = completedCaptureFor(token);
  if (completedAfterWait) return completedAfterWait;

  if (!sameCaptureToken(activeCaptureToken, token)) {
    throw new Error('Esta captura ya no está activa. Si ya guardaste desde Chromium, vuelve al Administrador: el snapshot debe aparecer como guardado. Si no aparece, genera una captura nueva.');
  }

  const result = await engine().saveActive();
  if (sameCaptureToken(activeCaptureToken, token)) activeCaptureToken = null;
  console.log(
    `Session Manager KAIZEN saved active capture v${result.version || '?'}: `
    + `${result.cookieCount || 0} cookies, ${result.indexedDbCount || 0} IndexedDB databases.`,
  );
  return result;
}

async function handleProtocolUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'userflex-session:') throw new Error('Enlace de Session Manager inválido.');
  if (url.hostname === 'guest') return startGuest(rawUrl);
  if (url.hostname === 'capture') return startCapture(rawUrl);
  if (url.hostname === 'save') return saveActiveCapture(rawUrl);
  throw new Error(`Acción no compatible con Session Manager v${app.getVersion()}. Cierra esta versión e instala la actualización más reciente.`);
}

function showFatalError(error) {
  const message = error instanceof Error ? error.message : String(error || 'Error inesperado.');
  const code = String(error?.code || 'SESSION_MANAGER_ERROR');
  const requestId = String(error?.requestId || '');
  const html = `<!doctype html><meta charset="utf-8"><title>userFLEX</title>
    <body style="font-family:system-ui;padding:28px;color:#0f172a">
      <h2>No se pudo completar la operación</h2>
      <p>${escapeHtml(message)}</p>
      <p style="color:#64748b">Código: ${escapeHtml(code)}${requestId ? ` · Solicitud: ${escapeHtml(requestId)}` : ''}</p>
      <p style="color:#64748b">Cierra esta ventana, corrige el problema indicado y vuelve a intentarlo desde el panel.</p>
    </body>`;
  const win = new BrowserWindow({
    width: 720,
    height: 360,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false },
  });
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

process.on('unhandledRejection', (reason) => {
  console.error('Session Manager unhandled rejection:', reason instanceof Error ? reason.stack || reason.message : String(reason));
});
process.on('uncaughtExceptionMonitor', (error) => {
  console.error('Session Manager uncaught exception:', error?.stack || error?.message || error);
});
app.on('render-process-gone', (_event, _webContents, details) => {
  console.error('Session Manager renderer stopped:', details?.reason || 'unknown', details?.exitCode ?? '');
});

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
    // Managed sessions are validated once at capture. Session Manager no
    // longer wakes up periodically to revalidate them by age.
    configureKeeperStartup(false);
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
    void engine().close('app_exit')
      .catch(() => null)
      .finally(() => app.quit());
  });
}
