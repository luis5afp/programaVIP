import { app, BrowserWindow, WebContentsView, ipcMain, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_ORIGIN = 'https://userflex-admin.luis5afp.workers.dev';
const HEARTBEAT_MS = 60_000;
const BROWSER_CHROME_HEIGHT = 92;

app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

let mainWindow = null;
let browserWindow = null;
let browserShellReady = false;
let activeProfileId = null;
let accessToken = null;
let authMeta = null;
let heartbeatTimer = null;
const profileTabs = new Map();

class UserflexError extends Error {
  constructor(message, code = 'CLIENT_ERROR', status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function authPath() {
  return path.join(app.getPath('userData'), 'auth.json');
}

function devicePath() {
  return path.join(app.getPath('userData'), 'device.json');
}

async function getDeviceKey() {
  try {
    const raw = JSON.parse(await fs.readFile(devicePath(), 'utf8'));
    if (typeof raw?.deviceKey === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(raw.deviceKey)) return raw.deviceKey;
  } catch {
    // First run.
  }
  const deviceKey = crypto.randomBytes(32).toString('base64url');
  await fs.mkdir(path.dirname(devicePath()), { recursive: true });
  await fs.writeFile(devicePath(), JSON.stringify({ deviceKey }), { encoding: 'utf8', mode: 0o600 });
  return deviceKey;
}

async function saveAuth(token, meta) {
  accessToken = token;
  authMeta = meta || null;
  if (!safeStorage.isEncryptionAvailable()) return;
  const encrypted = safeStorage.encryptString(token).toString('base64');
  await fs.mkdir(path.dirname(authPath()), { recursive: true });
  await fs.writeFile(authPath(), JSON.stringify({ token: encrypted, meta }), { encoding: 'utf8', mode: 0o600 });
}

async function loadAuth() {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const raw = JSON.parse(await fs.readFile(authPath(), 'utf8'));
    if (typeof raw?.token !== 'string') return null;
    const token = safeStorage.decryptString(Buffer.from(raw.token, 'base64'));
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return null;
    accessToken = token;
    authMeta = raw.meta || null;
    return { token, meta: authMeta };
  } catch {
    return null;
  }
}

async function clearAuth() {
  accessToken = null;
  authMeta = null;
  stopHeartbeat();
  try {
    await fs.unlink(authPath());
  } catch {
    // Already removed.
  }
}

async function apiRequest(pathName, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.token !== false && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(`${API_ORIGIN}${pathName}`, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeout || 20_000),
    });
  } catch (error) {
    throw new UserflexError(`No se pudo conectar con userFLEX: ${error?.message || 'error de red'}`, 'NETWORK_ERROR');
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { error: text };
  }
  if (!response.ok) {
    throw new UserflexError(payload?.error || `HTTP ${response.status}`, payload?.code || 'HTTP_ERROR', response.status);
  }
  return payload;
}

async function catalog() {
  if (!accessToken) throw new UserflexError('Inicia sesión para continuar.', 'CLIENT_UNAUTHENTICATED', 401);
  try {
    return await apiRequest('/api/client/catalog');
  } catch (error) {
    if (error?.status === 401 || ['CLIENT_UNAUTHENTICATED', 'CLIENT_SUSPENDED', 'DEVICE_REVOKED', 'SUBSCRIPTION_INACTIVE'].includes(error?.code)) {
      closePrivateBrowser();
      await clearAuth();
    }
    throw error;
  }
}

function serializeError(error) {
  return {
    message: error?.message || 'Error inesperado.',
    code: error?.code || 'CLIENT_ERROR',
    status: Number(error?.status || 0),
  };
}

function sendMain(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(async () => {
    if (!accessToken) return;
    try {
      const result = await apiRequest('/api/client/heartbeat', { method: 'POST' });
      sendMain('userflex:heartbeat', result);
      if (result?.revoke === true || result?.active === false) {
        closePrivateBrowser();
        await clearAuth();
        sendMain('userflex:auth-invalidated', { message: 'La sesión del cliente fue revocada.' });
      }
    } catch (error) {
      if (error?.status === 401 || ['CLIENT_UNAUTHENTICATED', 'CLIENT_SUSPENDED', 'DEVICE_REVOKED', 'SUBSCRIPTION_INACTIVE'].includes(error?.code)) {
        closePrivateBrowser();
        await clearAuth();
        sendMain('userflex:auth-invalidated', serializeError(error));
      }
    }
  }, HEARTBEAT_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    title: 'userFLEX Client',
    backgroundColor: '#080b10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: false,
    },
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  void mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function proxyRules(proxy) {
  const host = String(proxy.host || '').trim();
  const port = Number(proxy.port || 0);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw new UserflexError('Configuración de proxy inválida.', 'PROXY_INVALID');
  return `http://${host}:${port}`;
}

async function publicIp(browserSession) {
  try {
    const response = await browserSession.fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
    if (!response.ok) return null;
    const payload = await response.json();
    return typeof payload?.ip === 'string' ? payload.ip.trim() : null;
  } catch {
    return null;
  }
}

function cookieSetPayload(cookie, fallbackUrl) {
  const fallback = new URL(fallbackUrl);
  const domain = typeof cookie.domain === 'string' && cookie.domain.trim() ? cookie.domain.trim() : fallback.hostname;
  const host = domain.replace(/^\./, '');
  const secure = cookie.secure !== false;
  const cookiePath = typeof cookie.path === 'string' && cookie.path.startsWith('/') ? cookie.path : '/';
  const value = {
    url: `${secure ? 'https:' : 'http:'}//${host}${cookiePath}`,
    name: String(cookie.name || ''),
    value: String(cookie.value || ''),
    path: cookiePath,
    secure,
    httpOnly: cookie.httpOnly === true,
  };
  if (domain) value.domain = domain;
  if (typeof cookie.expirationDate === 'number' && Number.isFinite(cookie.expirationDate)) value.expirationDate = cookie.expirationDate;
  if (['unspecified', 'no_restriction', 'lax', 'strict'].includes(cookie.sameSite)) value.sameSite = cookie.sameSite;
  return value;
}

async function restoreManagedSession(webContents, browserSession, profile, delivery) {
  const material = delivery?.material;
  if (!material || material.format !== 'userflex-browser-session-v1') {
    throw new UserflexError('El material de sesión del perfil no es compatible.', 'SESSION_MATERIAL_INVALID');
  }
  if (material.profileId && material.profileId !== profile.id) {
    throw new UserflexError('La sesión recibida no pertenecece a este perfil.', 'SESSION_PROFILE_MISMATCH');
  }
  const targetOrigin = new URL(profile.url).origin;
  if (material.allowedOrigin && material.allowedOrigin !== targetOrigin) {
    throw new UserflexError('El origen de la sesión no coincide con la web del perfil.', 'SESSION_ORIGIN_MISMATCH');
  }

  await browserSession.clearStorageData({ storages: ['cookies'] });
  const cookies = Array.isArray(material.cookies) ? material.cookies : [];
  for (const cookie of cookies) {
    if (!cookie?.name) continue;
    try {
      await browserSession.cookies.set(cookieSetPayload(cookie, profile.url));
    } catch {
      // Ignore an individual expired/invalid cookie while restoring the rest.
    }
  }

  await webContents.loadURL(profile.url);
  const storage = material.storage && typeof material.storage === 'object' ? material.storage : null;
  if (!storage) return;

  let currentOrigin = null;
  try {
    currentOrigin = new URL(webContents.getURL()).origin;
  } catch {
    return;
  }
  if (storage.origin && storage.origin !== currentOrigin) return;

  const localStorageData = storage.localStorage && typeof storage.localStorage === 'object' ? storage.localStorage : {};
  const sessionStorageData = storage.sessionStorage && typeof storage.sessionStorage === 'object' ? storage.sessionStorage : {};
  await webContents.executeJavaScript(`(() => {
    const localData = ${JSON.stringify(localStorageData)};
    const sessionData = ${JSON.stringify(sessionStorageData)};
    try { localStorage.clear(); } catch {}
    try { sessionStorage.clear(); } catch {}
    for (const [key, value] of Object.entries(localData)) { try { localStorage.setItem(key, String(value)); } catch {} }
    for (const [key, value] of Object.entries(sessionData)) { try { sessionStorage.setItem(key, String(value)); } catch {} }
    return true;
  })()`);
  webContents.reload();
}

function profileLabel(profile) {
  return profile?.tags?.[0] || profile?.name || 'Perfil';
}

function navigationCapability(webContents, direction) {
  try {
    if (direction === 'back') return Boolean(webContents.navigationHistory?.canGoBack?.() ?? webContents.canGoBack?.());
    return Boolean(webContents.navigationHistory?.canGoForward?.() ?? webContents.canGoForward?.());
  } catch {
    return false;
  }
}

function browserTabPayload(tab) {
  const webContents = tab.view.webContents;
  const lockedIp = tab.delivery?.networkLocked ? tab.delivery?.expectedPublicIp : null;
  return {
    id: tab.profile.id,
    label: profileLabel(tab.profile),
    imageUrl: tab.profile.imageUrl || null,
    url: webContents.isDestroyed() ? tab.profile.url : (webContents.getURL() || tab.profile.url),
    loading: tab.loading === true,
    canGoBack: !webContents.isDestroyed() && navigationCapability(webContents, 'back'),
    canGoForward: !webContents.isDestroyed() && navigationCapability(webContents, 'forward'),
    networkLabel: tab.connection?.mode === 'proxy'
      ? (lockedIp ? `IP protegida · ${lockedIp}` : 'Proxy del perfil')
      : 'Conexión directa',
  };
}

function browserState() {
  return {
    activeProfileId,
    tabs: Array.from(profileTabs.values()).map(browserTabPayload),
  };
}

function sendBrowserState() {
  if (!browserShellReady || !browserWindow || browserWindow.isDestroyed()) return;
  browserWindow.webContents.send('userflex-browser:state', browserState());
}

function layoutActiveProfileView() {
  if (!browserWindow || browserWindow.isDestroyed() || !activeProfileId) return;
  const tab = profileTabs.get(activeProfileId);
  if (!tab || tab.view.webContents.isDestroyed()) return;
  const [width, height] = browserWindow.getContentSize();
  tab.view.setBounds({
    x: 0,
    y: BROWSER_CHROME_HEIGHT,
    width: Math.max(1, width),
    height: Math.max(1, height - BROWSER_CHROME_HEIGHT),
  });
}

function cleanupProfileTab(tab, removeView = true) {
  if (!tab) return;
  if (tab.loginHandler) app.removeListener('login', tab.loginHandler);
  if (removeView && browserWindow && !browserWindow.isDestroyed()) {
    try {
      browserWindow.contentView.removeChildView(tab.view);
    } catch {
      // The view may already be detached during window teardown.
    }
  }
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
}

function createBrowserWindow() {
  if (browserWindow && !browserWindow.isDestroyed()) return browserWindow;
  browserShellReady = false;
  browserWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 960,
    minHeight: 680,
    title: 'userFLEX Browser',
    backgroundColor: '#090c12',
    webPreferences: {
      preload: path.join(__dirname, 'browser-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: false,
    },
  });
  browserWindow.on('resize', layoutActiveProfileView);
  browserWindow.webContents.on('did-finish-load', () => {
    browserShellReady = true;
    sendBrowserState();
  });
  browserWindow.on('closed', () => {
    const tabs = Array.from(profileTabs.values());
    browserWindow = null;
    browserShellReady = false;
    activeProfileId = null;
    profileTabs.clear();
    for (const tab of tabs) cleanupProfileTab(tab, false);
  });
  void browserWindow.loadFile(path.join(__dirname, 'browser.html'));
  return browserWindow;
}

function selectProfileTab(profileId) {
  const tab = profileTabs.get(profileId);
  if (!tab) return false;
  const window = createBrowserWindow();
  if (activeProfileId && activeProfileId !== profileId) {
    const previous = profileTabs.get(activeProfileId);
    if (previous) window.contentView.removeChildView(previous.view);
  }
  activeProfileId = profileId;
  window.contentView.addChildView(tab.view);
  layoutActiveProfileView();
  window.show();
  window.focus();
  sendBrowserState();
  return true;
}

function closeProfileTab(profileId) {
  const id = profileId || activeProfileId;
  if (!id) return false;
  const ids = Array.from(profileTabs.keys());
  const index = ids.indexOf(id);
  const tab = profileTabs.get(id);
  if (!tab) return false;
  const wasActive = activeProfileId === id;
  cleanupProfileTab(tab, true);
  profileTabs.delete(id);
  if (wasActive) {
    activeProfileId = null;
    const nextId = ids[index + 1] || ids[index - 1] || null;
    if (nextId && profileTabs.has(nextId)) selectProfileTab(nextId);
    else if (browserWindow && !browserWindow.isDestroyed()) browserWindow.close();
  } else {
    sendBrowserState();
  }
  return true;
}

function closePrivateBrowser() {
  const tabs = Array.from(profileTabs.values());
  profileTabs.clear();
  activeProfileId = null;
  for (const tab of tabs) cleanupProfileTab(tab, true);
  if (browserWindow && !browserWindow.isDestroyed()) browserWindow.close();
}

function tabNavigation(action, profileId) {
  const tab = profileTabs.get(profileId || activeProfileId);
  if (!tab || tab.view.webContents.isDestroyed()) return false;
  const webContents = tab.view.webContents;
  try {
    if (action === 'back' && navigationCapability(webContents, 'back')) {
      if (webContents.navigationHistory?.goBack) webContents.navigationHistory.goBack();
      else webContents.goBack();
    } else if (action === 'forward' && navigationCapability(webContents, 'forward')) {
      if (webContents.navigationHistory?.goForward) webContents.navigationHistory.goForward();
      else webContents.goForward();
    } else if (action === 'reload') {
      webContents.reload();
    } else if (action === 'home') {
      void webContents.loadURL(tab.profile.url);
    } else {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function attachProfileViewEvents(tab) {
  const webContents = tab.view.webContents;
  const update = () => sendBrowserState();
  webContents.on('did-start-loading', () => {
    tab.loading = true;
    update();
  });
  webContents.on('did-stop-loading', () => {
    tab.loading = false;
    update();
  });
  webContents.on('did-navigate', update);
  webContents.on('did-navigate-in-page', update);
  webContents.on('page-title-updated', update);
  webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === 'https:' || target.protocol === 'http:') void webContents.loadURL(target.toString());
    } catch {
      // Ignore invalid popups.
    }
    return { action: 'deny' };
  });
}

async function openProfile(profileId) {
  if (!accessToken) throw new UserflexError('Inicia sesión para continuar.', 'CLIENT_UNAUTHENTICATED', 401);
  if (profileTabs.has(profileId)) {
    selectProfileTab(profileId);
    return { ok: true, reused: true };
  }

  const launch = await apiRequest(`/api/client/profiles/${profileId}/launch`, { method: 'POST' });
  const profile = launch?.profile;
  const connection = launch?.connection || { mode: 'direct', locked: false };
  const delivery = launch?.sessionDelivery || null;
  if (!profile?.id || !profile?.url) throw new UserflexError('El servidor devolvió un perfil incompleto.', 'PROFILE_INVALID');

  const partitionClientId = authMeta?.client?.id || 'client';
  const partition = `persist:userflex-client-${partitionClientId}-${profile.id}`;
  const view = new WebContentsView({
    webPreferences: {
      partition,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: false,
    },
  });
  view.setBackgroundColor('#ffffff');
  const browserSession = view.webContents.session;
  let loginHandler = null;

  if (connection.mode === 'proxy' && connection.proxy) {
    await browserSession.setProxy({
      mode: 'fixed_servers',
      proxyRules: proxyRules(connection.proxy),
      proxyBypassRules: '<-loopback>',
    });
    const proxyHost = String(connection.proxy.host || '').toLowerCase();
    loginHandler = (event, targetWebContents, _details, authInfo, callback) => {
      if (targetWebContents !== view.webContents) return;
      if (!authInfo?.isProxy || String(authInfo.host || '').toLowerCase() !== proxyHost) return;
      event.preventDefault();
      callback(connection.proxy.username || '', connection.proxy.password || '');
    };
    app.on('login', loginHandler);
  } else {
    await browserSession.setProxy({ mode: 'direct' });
  }

  const tab = {
    profile,
    connection,
    delivery,
    view,
    loginHandler,
    loading: false,
  };
  attachProfileViewEvents(tab);

  try {
    if (connection.locked === true && connection.mode !== 'proxy') {
      throw new UserflexError('El perfil exige una salida protegida y el proxy no está disponible.', 'NETWORK_LOCK_REQUIRED');
    }
    if (connection.locked === true) {
      const detectedIp = await publicIp(browserSession);
      if (!detectedIp) throw new UserflexError('No se pudo validar la IP de salida del perfil.', 'EGRESS_IP_UNVERIFIED');
      if (delivery?.expectedPublicIp && detectedIp !== delivery.expectedPublicIp) {
        throw new UserflexError(`La IP de salida no coincide con el perfil. Esperada: ${delivery.expectedPublicIp}. Detectada: ${detectedIp}.`, 'EGRESS_IP_MISMATCH');
      }
    }

    if (profile.sessionMode === 'managed-first-party') {
      if (!delivery?.ready || !delivery?.materialIncluded) {
        throw new UserflexError('La sesión administrada todavía no está lista.', 'MANAGED_SESSION_NOT_READY');
      }
      await restoreManagedSession(view.webContents, browserSession, profile, delivery);
    } else {
      await view.webContents.loadURL(profile.url);
    }

    profileTabs.set(profile.id, tab);
    selectProfileTab(profile.id);
    return {
      ok: true,
      reused: false,
      tabbed: true,
      network: connection.mode,
      networkLocked: connection.locked === true,
      sessionVersion: Number(delivery?.version || 0),
    };
  } catch (error) {
    cleanupProfileTab(tab, false);
    throw error;
  }
}

ipcMain.handle('userflex:bootstrap', async () => {
  try {
    if (!accessToken) await loadAuth();
    if (!accessToken) return { authenticated: false };
    const data = await catalog();
    startHeartbeat();
    return { authenticated: true, auth: authMeta, catalog: data };
  } catch (error) {
    return { authenticated: false, error: serializeError(error) };
  }
});

ipcMain.handle('userflex:login', async (_event, input) => {
  try {
    const identifier = String(input?.identifier || '').trim();
    const password = String(input?.password || '');
    if (!identifier || !password) throw new UserflexError('Ingresa usuario/correo y contraseña.', 'LOGIN_REQUIRED');
    const deviceKey = await getDeviceKey();
    const result = await apiRequest('/api/client/auth', {
      method: 'POST',
      token: false,
      body: {
        identifier,
        password,
        deviceKey,
        deviceName: os.hostname().slice(0, 120) || 'PC Windows',
        os: `${process.platform} ${os.release()}`,
      },
    });
    const meta = {
      client: result.client,
      plan: result.plan,
      subscription: result.subscription,
      expiresAt: result.expiresAt,
    };
    await saveAuth(result.accessToken, meta);
    const data = await catalog();
    startHeartbeat();
    return { ok: true, auth: meta, catalog: data };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});

ipcMain.handle('userflex:catalog', async () => {
  try {
    const data = await catalog();
    return { ok: true, catalog: data, auth: authMeta };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});

ipcMain.handle('userflex:launch-profile', async (_event, profileId) => {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(String(profileId || ''))) throw new UserflexError('Perfil inválido.', 'PROFILE_INVALID');
    return await openProfile(String(profileId));
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});

ipcMain.handle('userflex-browser:get-state', (event) => {
  if (!browserWindow || browserWindow.isDestroyed() || event.sender !== browserWindow.webContents) {
    return { activeProfileId: null, tabs: [] };
  }
  return browserState();
});

ipcMain.handle('userflex-browser:action', (event, input) => {
  if (!browserWindow || browserWindow.isDestroyed() || event.sender !== browserWindow.webContents) return { ok: false };
  const action = String(input?.action || '');
  const profileId = typeof input?.profileId === 'string' ? input.profileId : activeProfileId;
  if (action === 'select') return { ok: selectProfileTab(profileId) };
  if (action === 'close') return { ok: closeProfileTab(profileId) };
  if (['back', 'forward', 'reload', 'home'].includes(action)) return { ok: tabNavigation(action, profileId) };
  if (action === 'catalog') {
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
    mainWindow.show();
    mainWindow.focus();
    return { ok: true };
  }
  return { ok: false };
});

ipcMain.handle('userflex:logout', async () => {
  try {
    if (accessToken) await apiRequest('/api/client/logout', { method: 'POST' }).catch(() => null);
    closePrivateBrowser();
    await clearAuth();
    return { ok: true };
  } catch (error) {
    closePrivateBrowser();
    await clearAuth();
    return { ok: false, error: serializeError(error) };
  }
});

app.whenReady().then(async () => {
  await getDeviceKey();
  await loadAuth();
  createMainWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on('window-all-closed', () => {
  stopHeartbeat();
  if (process.platform !== 'darwin') app.quit();
});
