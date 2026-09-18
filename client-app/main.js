import { app, BrowserWindow, WebContentsView, ipcMain, safeStorage, screen } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createKaizenBrowserEngine } from './browser-engine/kaizen-engine.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_ORIGIN = 'https://userflex-admin.luis5afp.workers.dev';
const HEARTBEAT_MS = 60 * 1000;
const GOOGLE_URL = 'https://www.google.com/';
const TAB_STRIP_HEIGHT = 47;
const BROWSER_CHROME_HEIGHT = 92;
const PROFILE_WINDOW_CHROME_HEIGHT = 88;

app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

let mainWindow = null;
let browserWindow = null;
let browserShellReady = false;
let catalogView = null;
let activeContentView = null;
let activeProfileId = null;
let pendingCatalogTab = false;
let accessToken = null;
let authMeta = null;
let heartbeatTimer = null;
const profileTabs = new Map();
let profileOrder = [];
let profileDragMonitor = null;
const pendingUsageCloseRequests = new Set();
let quitAfterUsageFlush = false;
let kaizenBrowserEngine = null;

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

function isLocalPermissionError(error) {
  return ['EPERM', 'EACCES'].includes(String(error?.code || ''));
}

async function currentWindowsUserSid() {
  if (process.platform !== 'win32') return null;
  try {
    const result = await execFileAsync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {
      windowsHide: true,
      timeout: 4_000,
    });
    return String(result?.stdout || '').match(/"[^"]*","(S-[^"]+)"/i)?.[1] || null;
  } catch {
    return null;
  }
}

async function repairLocalPathAccess(targetPath) {
  if (process.platform !== 'win32' || !targetPath) return false;
  const sid = await currentWindowsUserSid();
  if (!sid) return false;
  try {
    await execFileAsync('icacls.exe', [
      targetPath,
      '/inheritance:e',
      '/grant:r',
      `*${sid}:F`,
      '/Q',
    ], { windowsHide: true, timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function readExistingDeviceKey() {
  const raw = JSON.parse(await fs.readFile(devicePath(), 'utf8'));
  return typeof raw?.deviceKey === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(raw.deviceKey)
    ? raw.deviceKey
    : null;
}

async function getDeviceKey() {
  let readError = null;
  try {
    const existing = await readExistingDeviceKey();
    if (existing) return existing;
  } catch (error) {
    readError = error;
  }

  if (isLocalPermissionError(readError)) {
    await repairLocalPathAccess(app.getPath('userData'));
    await repairLocalPathAccess(devicePath());
    try {
      const existing = await readExistingDeviceKey();
      if (existing) return existing;
    } catch {}
  }

  const deviceKey = crypto.randomBytes(32).toString('base64url');
  await fs.mkdir(path.dirname(devicePath()), { recursive: true });
  try {
    await fs.writeFile(devicePath(), JSON.stringify({ deviceKey }), { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    if (!isLocalPermissionError(error)) throw error;
    await repairLocalPathAccess(app.getPath('userData'));
    await repairLocalPathAccess(devicePath());
    await fs.writeFile(devicePath(), JSON.stringify({ deviceKey }), { encoding: 'utf8', mode: 0o600 });
  }
  return deviceKey;
}

async function saveAuth(token, meta) {
  accessToken = token;
  authMeta = meta || null;
  if (!safeStorage.isEncryptionAvailable()) return;
  const encrypted = safeStorage.encryptString(token).toString('base64');
  const file = authPath();
  const payload = JSON.stringify({ token: encrypted, meta });
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(file, payload, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    if (!isLocalPermissionError(error)) throw error;
    await repairLocalPathAccess(app.getPath('userData'));
    await repairLocalPathAccess(file);
    await fs.writeFile(file, payload, { encoding: 'utf8', mode: 0o600 });
  }
}

async function loadAuth() {
  if (!safeStorage.isEncryptionAvailable()) return null;

  const read = async () => {
    const raw = JSON.parse(await fs.readFile(authPath(), 'utf8'));
    if (typeof raw?.token !== 'string') return null;
    const token = safeStorage.decryptString(Buffer.from(raw.token, 'base64'));
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return null;
    accessToken = token;
    authMeta = raw.meta || null;
    return { token, meta: authMeta };
  };

  try {
    return await read();
  } catch (error) {
    if (!isLocalPermissionError(error)) return null;
    await repairLocalPathAccess(app.getPath('userData'));
    await repairLocalPathAccess(authPath());
    try { return await read(); } catch { return null; }
  }
}

async function clearAuth() {
  accessToken = null;
  authMeta = null;
  stopHeartbeat();
  try {
    await fs.unlink(authPath());
  } catch (error) {
    if (!isLocalPermissionError(error)) return;
    await repairLocalPathAccess(app.getPath('userData'));
    await repairLocalPathAccess(authPath());
    await fs.unlink(authPath()).catch(() => null);
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

function closeWorkspaceUsage(workspace, reason = 'profile_closed') {
  if (!workspace?.usageId || workspace.usageClosed === true) return Promise.resolve(true);
  if (workspace.usageClosePromise) return workspace.usageClosePromise;
  const request = apiRequest(`/api/client/profile-usage/${workspace.usageId}/close`, {
    method: 'POST',
    body: { reason },
    timeout: 8_000,
  })
    .then(() => { workspace.usageClosed = true; return true; })
    .catch(() => false)
    .finally(() => {
      pendingUsageCloseRequests.delete(request);
      workspace.usageClosePromise = null;
    });
  workspace.usageClosePromise = request;
  pendingUsageCloseRequests.add(request);
  return request;
}

function getKaizenBrowserEngine() {
  if (kaizenBrowserEngine) return kaizenBrowserEngine;
  kaizenBrowserEngine = createKaizenBrowserEngine({
    app,
    onClosed: async (entry, reason) => {
      if (!entry?.usageId) return;
      const usage = {
        usageId: entry.usageId,
        usageClosed: false,
        usageClosePromise: null,
      };
      await closeWorkspaceUsage(usage, reason || 'browser_exit');
    },
    log: console,
  });
  return kaizenBrowserEngine;
}

async function flushUsageCloseRequests(timeoutMs = 1800) {
  const pending = Array.from(pendingUsageCloseRequests);
  if (!pending.length) return;
  await Promise.race([
    Promise.allSettled(pending),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

function authError(error) {
  return error?.status === 401 || ['CLIENT_UNAUTHENTICATED', 'CLIENT_SUSPENDED', 'DEVICE_REVOKED', 'SUBSCRIPTION_INACTIVE', 'PLAN_INACTIVE'].includes(error?.code);
}

async function catalog() {
  if (!accessToken) throw new UserflexError('Inicia sesión para continuar.', 'CLIENT_UNAUTHENTICATED', 401);
  try {
    return await apiRequest('/api/client/catalog');
  } catch (error) {
    if (authError(error)) await returnToLogin();
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

function sendClient(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  if (catalogView && !catalogView.webContents.isDestroyed()) catalogView.webContents.send(channel, payload);
}

function configRevisionFrom(payload) {
  return payload?.configRevision || payload?.client?.configRevision || null;
}

function mergeValidationMeta(payload) {
  if (!payload || typeof payload !== 'object') return;
  authMeta = authMeta || {};
  if (payload.client) authMeta.client = { ...(authMeta.client || {}), ...payload.client };
  const revision = configRevisionFrom(payload);
  if (revision) authMeta.client = { ...(authMeta.client || {}), configRevision: revision };
  if (payload.plan) authMeta.plan = { ...(authMeta.plan || {}), ...payload.plan };
  if (payload.expiresAt) authMeta.subscription = { ...(authMeta.subscription || {}), expiresAt: payload.expiresAt };
  if (payload.sessionExpiresAt) authMeta.expiresAt = payload.sessionExpiresAt;
}

async function syncClientConfiguration(payload, reason = 'server', knownCatalog = null) {
  const previousRevision = authMeta?.client?.configRevision || null;
  const nextRevision = configRevisionFrom(payload);
  const configChanged = Boolean(previousRevision && nextRevision && previousRevision !== nextRevision);
  mergeValidationMeta(payload);
  let freshCatalog = knownCatalog;
  if (configChanged && !freshCatalog) freshCatalog = await catalog();
  if (freshCatalog) {
    mergeValidationMeta(freshCatalog);
    const clientId = authMeta?.client?.id || null;
    const catalogProfiles = Array.isArray(freshCatalog.profiles) ? freshCatalog.profiles : [];
    if (clientId) {
      await getKaizenBrowserEngine()
        .reconcileCatalogProfiles(clientId, catalogProfiles)
        .catch((error) => console.warn('KAIZEN profile reconciliation failed:', error?.message || error));
    }
  }
  if (accessToken && authMeta) await saveAuth(accessToken, authMeta).catch(() => null);
  return { configChanged, catalog: freshCatalog, auth: authMeta, validationReason: reason };
}

async function runHeartbeat(reason = 'scheduled') {
  if (!accessToken) return;
  try {
    const result = await apiRequest('/api/client/heartbeat', { method: 'POST' });
    if (result?.revoke === true || result?.active === false) {
      await returnToLogin();
      return;
    }
    const sync = await syncClientConfiguration(result, reason);
    sendClient('userflex:heartbeat', { ...result, ...sync });
  } catch (error) {
    if (authError(error)) await returnToLogin();
  }
}

function startHeartbeat() {
  stopHeartbeat();
  // KAIZEN keeps browser sessions under frequent server revalidation. A short
  // heartbeat lets userFLOW react to revocation, plan/profile changes and new
  // managed-session generations without leaving a stale browser alive for hours.
  void runHeartbeat('startup');
  heartbeatTimer = setInterval(() => void runHeartbeat('60s'), HEARTBEAT_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    title: 'userFLOW',
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
  return mainWindow;
}

function isEmbeddedCatalogSender(sender) {
  try {
    return new URL(sender.getURL()).searchParams.get('embedded') === '1';
  } catch {
    return false;
  }
}

function enterWorkspace(sender) {
  if (isEmbeddedCatalogSender(sender)) return;
  setTimeout(() => {
    if (!accessToken) return;
    const sourceWindow = BrowserWindow.fromWebContents(sender);
    const workspace = createBrowserWindow();
    showCatalogTab('home');
    workspace.show();
    workspace.focus();
    if (sourceWindow && sourceWindow === mainWindow && !sourceWindow.isDestroyed()) sourceWindow.close();
  }, 0);
}

async function returnToLogin() {
  const clientId = authMeta?.client?.id || null;
  await getKaizenBrowserEngine().closeAll('logout').catch(() => null);
  closePrivateBrowser();
  await flushUsageCloseRequests();
  if (clientId) {
    await getKaizenBrowserEngine().clearClientProfiles(clientId, 'logout').catch(() => null);
  }
  await clearAuth();
  const loginWindow = createMainWindow();
  loginWindow.show();
  loginWindow.focus();
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

function activePage(workspace) {
  if (!workspace) return null;
  const byId = workspace.activePageId ? workspace.pages.get(workspace.activePageId) : null;
  if (byId) return byId;
  const firstId = workspace.pageOrder.find((id) => workspace.pages.has(id));
  if (!firstId) return null;
  workspace.activePageId = firstId;
  return workspace.pages.get(firstId) || null;
}

function pagePayload(page, fallbackLabel = 'Pestaña') {
  const webContents = page?.view?.webContents;
  const alive = Boolean(webContents && !webContents.isDestroyed());
  const title = alive ? (webContents.getTitle() || page.title || fallbackLabel) : (page?.title || fallbackLabel);
  return {
    id: page.id,
    title,
    url: alive ? (webContents.getURL() || '') : '',
    loading: page.loading === true,
    canGoBack: alive && navigationCapability(webContents, 'back'),
    canGoForward: alive && navigationCapability(webContents, 'forward'),
  };
}

function browserTabPayload(workspace) {
  const page = activePage(workspace);
  const webContents = page?.view?.webContents;
  const alive = Boolean(webContents && !webContents.isDestroyed());
  const lockedIp = workspace.delivery?.networkLocked ? workspace.delivery?.expectedPublicIp : null;
  return {
    id: workspace.profile.id,
    label: profileLabel(workspace.profile),
    imageUrl: workspace.profile.imageUrl || null,
    url: alive ? (webContents.getURL() || workspace.profile.url) : workspace.profile.url,
    loading: page?.loading === true,
    canGoBack: alive && navigationCapability(webContents, 'back'),
    canGoForward: alive && navigationCapability(webContents, 'forward'),
    networkLabel: workspace.connection?.mode === 'proxy'
      ? (lockedIp ? `IP protegida · ${lockedIp}` : 'Proxy del perfil')
      : 'Conexión directa',
  };
}

function attachedProfileIds() {
  return profileOrder.filter((id) => {
    const workspace = profileTabs.get(id);
    return Boolean(workspace && !workspace.detachedWindow);
  });
}

function browserState() {
  return {
    activeProfileId,
    catalogMode: activeProfileId ? null : (pendingCatalogTab ? 'pending' : 'home'),
    pendingTab: !activeProfileId && pendingCatalogTab,
    tabs: attachedProfileIds().map((id) => browserTabPayload(profileTabs.get(id))),
  };
}

function sendBrowserState() {
  if (!browserShellReady || !browserWindow || browserWindow.isDestroyed()) return;
  browserWindow.webContents.send('userflex-browser:state', browserState());
}

function detachedState(workspace) {
  const page = activePage(workspace);
  const lockedIp = workspace.delivery?.networkLocked ? workspace.delivery?.expectedPublicIp : null;
  return {
    profileId: workspace.profile.id,
    profileLabel: profileLabel(workspace.profile),
    profileImageUrl: workspace.profile.imageUrl || null,
    activePageId: page?.id || null,
    pages: workspace.pageOrder
      .map((id) => workspace.pages.get(id))
      .filter(Boolean)
      .map((item) => pagePayload(item, profileLabel(workspace.profile))),
    networkLabel: workspace.connection?.mode === 'proxy'
      ? (lockedIp ? `IP protegida · ${lockedIp}` : 'Proxy del perfil')
      : 'Conexión directa',
    allowExternalBrowsing: authMeta?.client?.allowExternalBrowsing === true,
  };
}

function sendDetachedState(workspace) {
  const window = workspace?.detachedWindow;
  if (!workspace?.detachedShellReady || !window || window.isDestroyed()) return;
  window.webContents.send('userflex-profile-window:state', detachedState(workspace));
}

function contentTop() {
  return activeProfileId ? BROWSER_CHROME_HEIGHT : TAB_STRIP_HEIGHT;
}

function layoutActiveContent() {
  if (!browserWindow || browserWindow.isDestroyed() || !activeContentView || activeContentView.webContents.isDestroyed()) return;
  const [width, height] = browserWindow.getContentSize();
  const top = contentTop();
  activeContentView.setBounds({ x: 0, y: top, width: Math.max(1, width), height: Math.max(1, height - top) });
}

function setActiveContent(view) {
  if (!browserWindow || browserWindow.isDestroyed()) return;
  if (activeContentView && activeContentView !== view) {
    try {
      browserWindow.contentView.removeChildView(activeContentView);
    } catch {
      // It may already be detached.
    }
  }
  activeContentView = view || null;
  if (activeContentView) {
    try {
      browserWindow.contentView.addChildView(activeContentView);
    } catch {
      // It may already be attached.
    }
  }
  layoutActiveContent();
}

function layoutDetachedProfile(workspace) {
  const window = workspace?.detachedWindow;
  const page = activePage(workspace);
  if (!window || window.isDestroyed() || !page || page.view.webContents.isDestroyed()) return;
  const [width, height] = window.getContentSize();
  page.view.setBounds({
    x: 0,
    y: PROFILE_WINDOW_CHROME_HEIGHT,
    width: Math.max(1, width),
    height: Math.max(1, height - PROFILE_WINDOW_CHROME_HEIGHT),
  });
}

function detachViewFromPossibleParents(view, workspace) {
  if (!view) return;
  try {
    if (browserWindow && !browserWindow.isDestroyed()) browserWindow.contentView.removeChildView(view);
  } catch {
    // Not attached to the main window.
  }
  try {
    const detachedWindow = workspace?.detachedWindow;
    if (detachedWindow && !detachedWindow.isDestroyed()) detachedWindow.contentView.removeChildView(view);
  } catch {
    // Not attached to the detached window.
  }
  if (activeContentView === view) activeContentView = null;
}

function setDetachedActivePage(workspace, pageId) {
  const window = workspace?.detachedWindow;
  const next = workspace?.pages.get(pageId);
  if (!window || window.isDestroyed() || !next || next.view.webContents.isDestroyed()) return false;
  const previous = activePage(workspace);
  if (previous && previous !== next) {
    try {
      window.contentView.removeChildView(previous.view);
    } catch {
      // It may already be detached.
    }
  }
  workspace.activePageId = pageId;
  try {
    window.contentView.addChildView(next.view);
  } catch {
    // It may already be attached.
  }
  layoutDetachedProfile(workspace);
  sendDetachedState(workspace);
  return true;
}

function cleanupPage(workspace, page) {
  if (!page) return;
  detachViewFromPossibleParents(page.view, workspace);
  if (!page.view.webContents.isDestroyed()) page.view.webContents.close();
}

function cleanupWorkspace(workspace, reason = 'profile_closed') {
  if (!workspace || workspace.cleaned) return;
  workspace.cleaned = true;
  void closeWorkspaceUsage(workspace, reason);
  if (workspace.loginHandler) app.removeListener('login', workspace.loginHandler);
  for (const page of workspace.pages.values()) cleanupPage(workspace, page);
  workspace.pages.clear();
  workspace.pageOrder = [];
  workspace.activePageId = null;
}

function createCatalogView() {
  if (catalogView && !catalogView.webContents.isDestroyed()) return catalogView;
  catalogView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: false,
    },
  });
  catalogView.setBackgroundColor('#070a0f');
  catalogView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  void catalogView.webContents.loadFile(path.join(__dirname, 'index.html'), { query: { embedded: '1' } });
  return catalogView;
}

function createBrowserWindow() {
  if (browserWindow && !browserWindow.isDestroyed()) return browserWindow;
  browserShellReady = false;
  activeContentView = null;
  browserWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 960,
    minHeight: 680,
    title: 'userFLOW',
    show: false,
    backgroundColor: '#090c12',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0c1018', symbolColor: '#cbd5e1', height: 47 },
    webPreferences: {
      preload: path.join(__dirname, 'browser-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: false,
    },
  });
  browserWindow.on('resize', layoutActiveContent);
  browserWindow.webContents.on('did-finish-load', () => {
    browserShellReady = true;
    sendBrowserState();
    layoutActiveContent();
    if (!browserWindow?.isDestroyed()) browserWindow.show();
  });
  browserWindow.on('closed', () => {
    stopProfileDragMonitor();
    const workspaces = Array.from(profileTabs.values());
    browserWindow = null;
    browserShellReady = false;
    activeProfileId = null;
    pendingCatalogTab = false;
    activeContentView = null;
    profileTabs.clear();
    profileOrder = [];
    for (const workspace of workspaces) {
      if (workspace.detachedWindow && !workspace.detachedWindow.isDestroyed()) {
        workspace.closing = true;
        workspace.detachedWindow.close();
      }
      cleanupWorkspace(workspace);
    }
    if (catalogView && !catalogView.webContents.isDestroyed()) catalogView.webContents.close();
    catalogView = null;
  });
  void browserWindow.loadFile(path.join(__dirname, 'browser.html'));
  return browserWindow;
}

function showCatalogTab(mode = 'home') {
  const window = createBrowserWindow();
  activeProfileId = null;
  pendingCatalogTab = mode === 'pending';
  setActiveContent(createCatalogView());
  sendBrowserState();
  window.show();
  window.focus();
  return true;
}

function selectProfileTab(profileId) {
  const workspace = profileTabs.get(profileId);
  if (!workspace) return false;
  if (workspace.detachedWindow && !workspace.detachedWindow.isDestroyed()) {
    pendingCatalogTab = false;
    sendBrowserState();
    workspace.detachedWindow.show();
    workspace.detachedWindow.focus();
    return true;
  }
  const page = activePage(workspace);
  if (!page) return false;
  const window = createBrowserWindow();
  activeProfileId = profileId;
  pendingCatalogTab = false;
  setActiveContent(page.view);
  sendBrowserState();
  window.show();
  window.focus();
  return true;
}

function removeWorkspace(profileId) {
  const workspace = profileTabs.get(profileId);
  if (!workspace) return false;
  cleanupWorkspace(workspace);
  profileTabs.delete(profileId);
  profileOrder = profileOrder.filter((id) => id !== profileId);
  return true;
}

function closeProfileTab(profileId) {
  const id = profileId || activeProfileId;
  if (!id) return false;
  const attachedIds = attachedProfileIds();
  const index = attachedIds.indexOf(id);
  const workspace = profileTabs.get(id);
  if (!workspace) return false;
  if (workspace.detachedWindow && !workspace.detachedWindow.isDestroyed()) {
    workspace.detachedWindow.close();
    return true;
  }
  const wasActive = activeProfileId === id;
  removeWorkspace(id);
  if (wasActive) {
    activeProfileId = null;
    const remaining = attachedProfileIds();
    const nextId = remaining[Math.min(index, Math.max(0, remaining.length - 1))] || remaining[index - 1] || null;
    if (nextId) selectProfileTab(nextId);
    else showCatalogTab('home');
  } else {
    sendBrowserState();
  }
  return true;
}

function closePrivateBrowser() {
  stopProfileDragMonitor();
  const workspaces = Array.from(profileTabs.values());
  profileTabs.clear();
  profileOrder = [];
  activeProfileId = null;
  pendingCatalogTab = false;
  for (const workspace of workspaces) {
    workspace.closing = true;
    if (workspace.detachedWindow && !workspace.detachedWindow.isDestroyed()) workspace.detachedWindow.close();
    cleanupWorkspace(workspace);
  }
  if (catalogView && !catalogView.webContents.isDestroyed()) {
    try {
      if (browserWindow && !browserWindow.isDestroyed()) browserWindow.contentView.removeChildView(catalogView);
    } catch {
      // Already detached.
    }
    catalogView.webContents.close();
  }
  catalogView = null;
  activeContentView = null;
  if (browserWindow && !browserWindow.isDestroyed()) browserWindow.close();
}

function pageNavigation(workspace, page, action) {
  if (!workspace || !page || page.view.webContents.isDestroyed()) return false;
  const webContents = page.view.webContents;
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
      void webContents.loadURL(workspace.profile.url);
    } else {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function tabNavigation(action, profileId) {
  const workspace = profileTabs.get(profileId || activeProfileId);
  const page = activePage(workspace);
  return pageNavigation(workspace, page, action);
}

function updateWorkspaceState(workspace) {
  if (workspace.detachedWindow) sendDetachedState(workspace);
  else sendBrowserState();
}

function attachProfilePageEvents(workspace, page) {
  const webContents = page.view.webContents;
  const update = () => updateWorkspaceState(workspace);
  webContents.on('did-start-loading', () => {
    page.loading = true;
    update();
  });
  webContents.on('did-stop-loading', () => {
    page.loading = false;
    update();
  });
  webContents.on('did-navigate', update);
  webContents.on('did-navigate-in-page', update);
  webContents.on('page-title-updated', (_event, title) => {
    page.title = title || page.title;
    update();
  });
  webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol !== 'https:' && target.protocol !== 'http:') return { action: 'deny' };
      if (workspace.detachedWindow && !workspace.detachedWindow.isDestroyed()) {
        void createProfilePage(workspace, target.toString(), true);
      } else {
        void webContents.loadURL(target.toString());
      }
    } catch {
      // Ignore invalid popups.
    }
    return { action: 'deny' };
  });
}

function createProfilePageView(workspace) {
  const view = new WebContentsView({
    webPreferences: {
      partition: workspace.partition,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: false,
    },
  });
  view.setBackgroundColor('#ffffff');
  const page = {
    id: crypto.randomUUID(),
    view,
    loading: false,
    title: profileLabel(workspace.profile),
  };
  workspace.pages.set(page.id, page);
  workspace.pageOrder.push(page.id);
  attachProfilePageEvents(workspace, page);
  return page;
}

async function createProfilePage(workspace, url = workspace.profile.url, activate = true) {
  const page = createProfilePageView(workspace);
  try {
    await page.view.webContents.loadURL(url);
    if (activate) {
      workspace.activePageId = page.id;
      if (workspace.detachedWindow && !workspace.detachedWindow.isDestroyed()) setDetachedActivePage(workspace, page.id);
    }
    updateWorkspaceState(workspace);
    return page;
  } catch (error) {
    cleanupPage(workspace, page);
    workspace.pages.delete(page.id);
    workspace.pageOrder = workspace.pageOrder.filter((id) => id !== page.id);
    throw error;
  }
}

function closeDetachedPage(workspace, pageId) {
  const page = workspace?.pages.get(pageId);
  if (!workspace || !page) return false;
  const index = workspace.pageOrder.indexOf(pageId);
  const wasActive = workspace.activePageId === pageId;
  cleanupPage(workspace, page);
  workspace.pages.delete(pageId);
  workspace.pageOrder = workspace.pageOrder.filter((id) => id !== pageId);
  if (workspace.pages.size === 0) {
    if (workspace.detachedWindow && !workspace.detachedWindow.isDestroyed()) workspace.detachedWindow.close();
    return true;
  }
  if (wasActive) {
    const nextId = workspace.pageOrder[Math.min(index, workspace.pageOrder.length - 1)] || workspace.pageOrder[index - 1];
    if (nextId) setDetachedActivePage(workspace, nextId);
  } else {
    sendDetachedState(workspace);
  }
  return true;
}

function reorderDetachedPages(workspace, pageId, targetIndex) {
  if (!workspace?.pages.has(pageId)) return false;
  const order = workspace.pageOrder.filter((id) => workspace.pages.has(id));
  const from = order.indexOf(pageId);
  if (from < 0) return false;
  const clamped = Math.max(0, Math.min(Number(targetIndex) || 0, order.length - 1));
  order.splice(from, 1);
  order.splice(clamped, 0, pageId);
  workspace.pageOrder = order;
  sendDetachedState(workspace);
  return true;
}

function reorderProfiles(profileId, targetIndex) {
  const attached = attachedProfileIds();
  const from = attached.indexOf(profileId);
  if (from < 0) return false;
  const clamped = Math.max(0, Math.min(Number(targetIndex) || 0, attached.length - 1));
  attached.splice(from, 1);
  attached.splice(clamped, 0, profileId);
  const detached = profileOrder.filter((id) => !attached.includes(id));
  profileOrder = [...attached, ...detached];
  sendBrowserState();
  return true;
}

function workspaceForDetachedSender(sender) {
  for (const workspace of profileTabs.values()) {
    const window = workspace.detachedWindow;
    if (window && !window.isDestroyed() && window.webContents === sender) return workspace;
  }
  return null;
}

function createDetachedProfileWindow(workspace, point = null) {
  if (!workspace || workspace.detachedWindow) return workspace?.detachedWindow || null;
  const opts = {
    width: 1240,
    height: 850,
    minWidth: 760,
    minHeight: 560,
    title: `userFLOW · ${profileLabel(workspace.profile)}`,
    show: false,
    backgroundColor: '#090c12',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0c1018', symbolColor: '#cbd5e1', height: 47 },
    webPreferences: {
      preload: path.join(__dirname, 'profile-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: false,
    },
  };
  if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) {
    opts.x = Math.max(0, Math.round(point.x - 180));
    opts.y = Math.max(0, Math.round(point.y - 24));
  }
  const window = new BrowserWindow(opts);
  workspace.detachedWindow = window;
  workspace.detachedShellReady = false;
  workspace.closing = false;

  window.on('resize', () => layoutDetachedProfile(workspace));
  window.webContents.on('did-finish-load', () => {
    workspace.detachedShellReady = true;
    const page = activePage(workspace);
    if (page) setDetachedActivePage(workspace, page.id);
    sendDetachedState(workspace);
    if (!window.isDestroyed()) {
      window.show();
      window.focus();
    }
  });
  window.on('closed', () => {
    workspace.detachedWindow = null;
    workspace.detachedShellReady = false;
    if (!workspace.closing) {
      cleanupWorkspace(workspace);
      profileTabs.delete(workspace.profile.id);
      profileOrder = profileOrder.filter((id) => id !== workspace.profile.id);
      sendBrowserState();
    }
  });
  void window.loadFile(path.join(__dirname, 'profile-window.html'));
  return window;
}

function stopProfileDragMonitor() {
  if (profileDragMonitor?.timer) clearInterval(profileDragMonitor.timer);
  profileDragMonitor = null;
}

function beginProfileDragMonitor(profileId) {
  stopProfileDragMonitor();
  if (!browserWindow || browserWindow.isDestroyed()) return false;
  const workspace = profileTabs.get(profileId);
  if (!workspace || workspace.detachedWindow) return false;

  const monitor = { profileId, timer: null };
  monitor.timer = setInterval(() => {
    if (profileDragMonitor !== monitor) return;
    const current = profileTabs.get(profileId);
    if (!browserWindow || browserWindow.isDestroyed() || !current || current.detachedWindow) {
      stopProfileDragMonitor();
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    const bounds = browserWindow.getBounds();
    const windowMargin = 18;
    const tabDetachDistance = 34;
    const outsideWindow = cursor.x < bounds.x - windowMargin
      || cursor.x > bounds.x + bounds.width + windowMargin
      || cursor.y < bounds.y - windowMargin
      || cursor.y > bounds.y + bounds.height + windowMargin;
    const leftTabStrip = cursor.y > bounds.y + TAB_STRIP_HEIGHT + tabDetachDistance;
    if (!outsideWindow && !leftTabStrip) return;
    stopProfileDragMonitor();
    detachProfile(profileId, cursor);
  }, 25);
  profileDragMonitor = monitor;
  return true;
}

function endProfileDragMonitor(profileId) {
  const detached = Boolean(profileTabs.get(profileId)?.detachedWindow);
  if (!profileDragMonitor || profileDragMonitor.profileId === profileId) stopProfileDragMonitor();
  return detached;
}

function detachProfile(profileId, point = null) {
  if (profileDragMonitor?.profileId === profileId) stopProfileDragMonitor();
  const workspace = profileTabs.get(profileId);
  if (!workspace || workspace.detachedWindow) return false;
  const page = activePage(workspace);
  if (!page) return false;
  const wasActive = activeProfileId === profileId;
  detachViewFromPossibleParents(page.view, workspace);
  if (wasActive) {
    activeProfileId = null;
    const remaining = attachedProfileIds().filter((id) => id !== profileId);
    if (remaining.length) selectProfileTab(remaining[0]);
    else showCatalogTab('home');
  }
  createDetachedProfileWindow(workspace, point);
  sendBrowserState();
  return true;
}

function detachIfOutside(profileId, point) {
  if (!browserWindow || browserWindow.isDestroyed()) return false;
  let x = Number(point?.x);
  let y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) {
    const cursor = screen.getCursorScreenPoint();
    x = Number(cursor?.x);
    y = Number(cursor?.y);
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const bounds = browserWindow.getBounds();
  const outside = x < bounds.x || x > bounds.x + bounds.width || y < bounds.y || y > bounds.y + bounds.height;
  return outside ? detachProfile(profileId, { x, y }) : false;
}

async function openProfile(profileId) {
  if (!accessToken) throw new UserflexError('Inicia sesión para continuar.', 'CLIENT_UNAUTHENTICATED', 401);

  const launch = await apiRequest(`/api/client/profiles/${profileId}/launch`, {
    method: 'POST',
    headers: {
      'X-Userflow-Profile-Usage': '1',
      'X-Userflow-Client-Version': app.getVersion(),
    },
  });
  const sync = await syncClientConfiguration(launch, 'profile-launch');
  if (sync.configChanged && sync.catalog) {
    sendClient('userflex:heartbeat', { active: true, revoke: false, ...sync });
  }

  const profile = launch?.profile;
  const connection = launch?.connection || { mode: 'direct', locked: false };
  const delivery = launch?.sessionDelivery || null;
  if (!profile?.id || !profile?.url) throw new UserflexError('El servidor devolvió un perfil incompleto.', 'PROFILE_INVALID');

  const usage = {
    usageId: launch?.usage?.id || null,
    usageClosed: false,
    usageClosePromise: null,
  };

  try {
    const result = await getKaizenBrowserEngine().launch({
      clientId: authMeta?.client?.id || 'client',
      profile,
      connection,
      delivery,
      usageId: usage.usageId,
    });
    return {
      ...result,
      ok: true,
      tabbed: false,
      engine: 'kaizen-external',
      sessionVersion: Number(delivery?.version || result?.sessionVersion || 0),
    };
  } catch (error) {
    await closeWorkspaceUsage(usage, 'launch_failed');
    if (!error?.code && /Chrome\/Chromium/i.test(String(error?.message || ''))) {
      error.code = 'KAIZEN_BROWSER_RUNTIME_MISSING';
    }
    throw error;
  }
}

ipcMain.handle('userflex:bootstrap', async (event) => {
  try {
    if (!accessToken) await loadAuth();
    if (!accessToken) return { authenticated: false };
    const data = await catalog();
    await syncClientConfiguration(data, 'bootstrap', data);
    startHeartbeat();
    enterWorkspace(event.sender);
    return { authenticated: true, auth: authMeta, catalog: data };
  } catch (error) {
    return { authenticated: false, error: serializeError(error) };
  }
});

ipcMain.handle('userflex:login', async (event, input) => {
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
    await syncClientConfiguration(data, 'login', data);
    startHeartbeat();
    enterWorkspace(event.sender);
    return { ok: true, auth: authMeta, catalog: data };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});

ipcMain.handle('userflex:catalog', async () => {
  try {
    const data = await catalog();
    await syncClientConfiguration(data, 'catalog', data);
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
    if (error?.code === 'PROFILE_NOT_INCLUDED_IN_PLAN') {
      try {
        const data = await catalog();
        const sync = await syncClientConfiguration(data, 'profile-rejected', data);
        sendClient('userflex:heartbeat', { active: true, revoke: false, ...sync, configChanged: true });
      } catch {}
    }
    return { ok: false, error: serializeError(error) };
  }
});

ipcMain.handle('userflex-browser:get-state', (event) => {
  if (!browserWindow || browserWindow.isDestroyed() || event.sender !== browserWindow.webContents) {
    return { activeProfileId: null, catalogMode: 'home', pendingTab: false, tabs: [] };
  }
  return browserState();
});

ipcMain.handle('userflex-browser:action', (event, input) => {
  if (!browserWindow || browserWindow.isDestroyed() || event.sender !== browserWindow.webContents) return { ok: false };
  const action = String(input?.action || '');
  const profileId = typeof input?.profileId === 'string' ? input.profileId : activeProfileId;
  if (action === 'select') return { ok: selectProfileTab(profileId) };
  if (action === 'close') return { ok: closeProfileTab(profileId) };
  if (action === 'reorder') return { ok: reorderProfiles(profileId, input?.targetIndex) };
  if (action === 'profile-drag-begin') return { ok: beginProfileDragMonitor(profileId) };
  if (action === 'profile-drag-end') return { ok: true, detached: endProfileDragMonitor(profileId) };
  if (action === 'detach') return { ok: detachProfile(profileId, { x: Number(input?.screenX), y: Number(input?.screenY) }) };
  if (action === 'detach-if-outside') return { ok: detachIfOutside(profileId, { x: Number(input?.screenX), y: Number(input?.screenY) }) };
  if (['back', 'forward', 'reload', 'home'].includes(action)) return { ok: tabNavigation(action, profileId) };
  if (action === 'catalog-home') return { ok: showCatalogTab('home') };
  if (action === 'new-tab') return { ok: showCatalogTab('pending') };
  if (action === 'close-pending') return { ok: showCatalogTab('home') };
  return { ok: false };
});

ipcMain.handle('userflex-profile-window:get-state', (event) => {
  const workspace = workspaceForDetachedSender(event.sender);
  return workspace ? detachedState(workspace) : null;
});

ipcMain.handle('userflex-profile-window:action', async (event, input) => {
  const workspace = workspaceForDetachedSender(event.sender);
  if (!workspace) return { ok: false };
  const action = String(input?.action || '');
  const pageId = typeof input?.pageId === 'string' ? input.pageId : workspace.activePageId;
  if (action === 'select-page') return { ok: setDetachedActivePage(workspace, pageId) };
  if (action === 'close-page') return { ok: closeDetachedPage(workspace, pageId) };
  if (action === 'reorder-page') return { ok: reorderDetachedPages(workspace, pageId, input?.targetIndex) };
  if (action === 'new-page') {
    try {
      const page = await createProfilePage(workspace, workspace.profile.url, true);
      return { ok: true, pageId: page.id };
    } catch (error) {
      return { ok: false, error: serializeError(error) };
    }
  }
  if (action === 'open-google') {
    if (authMeta?.client?.allowExternalBrowsing !== true) {
      return { ok: false, error: serializeError(new UserflexError('La navegación web adicional no está habilitada para este cliente.', 'EXTERNAL_BROWSING_DISABLED', 403)) };
    }
    try {
      const page = await createProfilePage(workspace, GOOGLE_URL, true);
      return { ok: true, pageId: page.id };
    } catch (error) {
      return { ok: false, error: serializeError(error) };
    }
  }
  if (['back', 'forward', 'reload', 'home'].includes(action)) {
    const page = workspace.pages.get(pageId) || activePage(workspace);
    return { ok: pageNavigation(workspace, page, action) };
  }
  return { ok: false };
});

ipcMain.handle('userflex:logout', async () => {
  try {
    if (accessToken) await apiRequest('/api/client/logout', { method: 'POST' }).catch(() => null);
    await returnToLogin();
    return { ok: true };
  } catch (error) {
    await returnToLogin();
    return { ok: false, error: serializeError(error) };
  }
});

app.on('before-quit', (event) => {
  if (quitAfterUsageFlush) return;
  event.preventDefault();
  quitAfterUsageFlush = true;
  for (const workspace of profileTabs.values()) void closeWorkspaceUsage(workspace, 'app_exit');
  void getKaizenBrowserEngine().closeAll('app_exit')
    .catch(() => null)
    .then(() => flushUsageCloseRequests())
    .finally(() => app.quit());
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
