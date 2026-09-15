import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSocksHttpBridge } from './proxy-bridge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let active = null;
let readyWindow = null;
let pendingProtocolUrl = null;
let protocolRegistered = false;

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

function showReadyWindow() {
  if (readyWindow && !readyWindow.isDestroyed()) {
    readyWindow.show();
    readyWindow.focus();
    return;
  }

  const status = protocolRegistered
    ? 'El protocolo userflex-session:// está registrado correctamente.'
    : 'Windows no confirmó el registro del protocolo. Reinstala userFLEX Session Manager si Cargar sesión no abre Chromium.';
  const tone = protocolRegistered ? '#166534' : '#9a3412';
  const background = protocolRegistered ? '#f0fdf4' : '#fff7ed';
  const html = `<!doctype html><meta charset="utf-8"><title>userFLEX Session Manager</title><body style="margin:0;background:#f8fafc;font-family:system-ui;color:#0f172a"><main style="max-width:620px;margin:56px auto;padding:0 24px"><div style="background:white;border:1px solid #e2e8f0;border-radius:18px;padding:28px;box-shadow:0 16px 45px rgba(15,23,42,.08)"><h2 style="margin:0 0 10px">userFLEX Session Manager</h2><p style="color:#475569;line-height:1.55">El componente local está instalado y listo para abrir el Chromium aislado de un perfil.</p><div style="margin:18px 0;padding:12px 14px;border-radius:12px;background:${background};color:${tone};font-weight:700">${status}</div><ol style="color:#475569;line-height:1.7;padding-left:20px"><li>Vuelve al panel userFLEX.</li><li>En un perfil con sesión administrada pulsa <b>Cargar sesión</b>.</li><li>Si el navegador pregunta si deseas abrir userFLEX Session Manager, acepta.</li></ol><p style="margin-bottom:0;color:#64748b;font-size:13px">Después se abrirá Chromium con el perfil aislado para completar el primer inicio de sesión y guardarlo.</p></div></main></body>`;

  readyWindow = new BrowserWindow({
    width: 720,
    height: 520,
    minWidth: 620,
    minHeight: 420,
    title: 'userFLEX Session Manager',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false },
  });
  readyWindow.on('closed', () => {
    readyWindow = null;
  });
  void readyWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

async function apiPost(endpoint, pathName, body) {
  const response = await fetch(`${endpoint}${pathName}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { error: text };
  }
  if (!response.ok) throw new Error(payload?.error || payload?.message || `HTTP ${response.status}`);
  return payload;
}

function assertCaptureUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'userflex-session:' || url.hostname !== 'capture') throw new Error('Enlace de captura inválido.');
  const endpoint = url.searchParams.get('endpoint') || '';
  const token = url.searchParams.get('token') || '';
  const endpointUrl = new URL(endpoint);
  if (endpointUrl.protocol !== 'https:') throw new Error('El endpoint de userFLEX debe usar HTTPS.');
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) throw new Error('Token de captura inválido.');
  return { endpoint: endpointUrl.origin, token };
}

async function discoverPublicIp(browserSession) {
  const endpoints = [
    'https://api.ipify.org?format=json',
    'https://api64.ipify.org?format=json',
  ];
  for (const endpoint of endpoints) {
    try {
      const response = await browserSession.fetch(endpoint, { cache: 'no-store' });
      if (!response.ok) continue;
      const payload = await response.json();
      if (typeof payload?.ip === 'string' && payload.ip.trim()) return payload.ip.trim();
    } catch {
      // Try the next independent IP endpoint.
    }
  }
  return null;
}

async function startCapture(rawUrl) {
  const { endpoint, token } = assertCaptureUrl(rawUrl);
  const bootstrap = await apiPost(endpoint, '/api/session-manager/bootstrap', { token });
  const profile = bootstrap.profile;
  const credentials = bootstrap.credentials;
  const proxy = bootstrap.proxy || null;
  if (!profile?.id || !profile?.url || !credentials?.username || !credentials?.password) {
    throw new Error('Configuración incompleta.');
  }

  if (readyWindow && !readyWindow.isDestroyed()) readyWindow.close();
  if (active?.window && !active.window.isDestroyed()) active.window.close();

  const partition = `persist:userflex-profile-${profile.id}`;
  const browserWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 650,
    title: `userFLEX · ${profile.name}`,
    show: false,
    webPreferences: {
      partition,
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: false,
    },
  });

  browserWindow.once('ready-to-show', () => {
    if (!browserWindow.isDestroyed()) {
      browserWindow.show();
      browserWindow.focus();
    }
  });

  const browserSession = browserWindow.webContents.session;
  let loginHandler = null;
  let proxyBridge = null;
  if (proxy?.host && proxy?.port) {
    const proxyType = String(proxy.type || 'http').toLowerCase();
    if (proxyType === 'ssh') throw new Error('El proxy SSH necesita un túnel local y todavía no está soportado por Session Manager.');

    let proxyRules = `${proxyType === 'https' ? 'https' : 'http'}://${proxy.host}:${proxy.port}`;
    if (proxyType === 'socks4' || proxyType === 'socks5') {
      proxyBridge = await startSocksHttpBridge(proxy);
      proxyRules = proxyBridge.proxyRules;
    }

    await browserSession.setProxy({
      mode: 'fixed_servers',
      proxyRules,
      proxyBypassRules: '<-loopback>',
    });

    if (proxyType !== 'socks4' && proxyType !== 'socks5') {
      loginHandler = (event, webContents, request, authInfo, callback) => {
        if (webContents.id !== browserWindow.webContents.id || !authInfo.isProxy) return;
        event.preventDefault();
        callback(proxy.username || '', proxy.password || '');
      };
      app.on('login', loginHandler);
    }
  } else {
    await browserSession.setProxy({ mode: 'direct' });
  }

  const allowedOrigin = new URL(profile.url).origin;
  const sendCredentials = () => {
    if (browserWindow.isDestroyed()) return;
    let currentOrigin = '';
    try {
      currentOrigin = new URL(browserWindow.webContents.getURL()).origin;
    } catch {
      return;
    }
    browserWindow.webContents.send('userflex:credentials', {
      allowedOrigin,
      currentOrigin,
      username: credentials.username,
      password: credentials.password,
    });
  };

  browserWindow.webContents.on('dom-ready', sendCredentials);
  browserWindow.webContents.on('did-navigate', sendCredentials);
  browserWindow.webContents.on('did-navigate-in-page', sendCredentials);

  browserWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === 'https:') {
        void browserWindow.loadURL(target.toString());
      }
    } catch {
      // Ignore invalid popups.
    }
    return { action: 'deny' };
  });

  browserWindow.on('closed', () => {
    if (loginHandler) app.removeListener('login', loginHandler);
    if (proxyBridge) void proxyBridge.close().catch(() => null);
    if (active?.window === browserWindow) active = null;
  });

  active = {
    endpoint,
    token,
    profile,
    proxy,
    proxyBridge,
    networkMode: proxy ? 'proxy' : 'direct',
    browserWindow,
    window: browserWindow,
    browserSession,
    allowedOrigin,
  };

  await browserWindow.loadURL(profile.url);
}

ipcMain.handle('userflex:save-session', async (event) => {
  if (!active || event.sender.id !== active.browserWindow.webContents.id) throw new Error('No hay captura activa.');
  const { browserWindow, browserSession, endpoint, token, allowedOrigin, profile, networkMode } = active;
  const currentUrl = browserWindow.webContents.getURL();
  if (!currentUrl.startsWith('https://')) throw new Error('La página actual no es HTTPS.');

  const cookies = await browserSession.cookies.get({});
  const storage = await browserWindow.webContents.executeJavaScript(`(() => {
    const read = (store) => {
      const result = {};
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (key) result[key] = store.getItem(key);
      }
      return result;
    };
    return {
      origin: location.origin,
      href: location.href,
      localStorage: read(window.localStorage),
      sessionStorage: read(window.sessionStorage),
    };
  })()`);

  const publicIp = await discoverPublicIp(browserSession);
  if (active.proxy && !publicIp) throw new Error('No se pudo validar la IP de salida mediante el proxy seleccionado.');
  const material = {
    format: 'userflex-browser-session-v1',
    profileId: profile.id,
    allowedOrigin,
    capturedUrl: currentUrl,
    capturedAt: new Date().toISOString(),
    network: { mode: networkMode },
    cookies: cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      expirationDate: cookie.expirationDate,
    })),
    storage,
  };

  const completed = await apiPost(endpoint, '/api/session-manager/complete', { token, publicIp, material });
  browserWindow.webContents.send('userflex:saved', { version: completed.version, publicIp: completed.public_ip || publicIp });
  return { ok: true, version: completed.version, publicIp: completed.public_ip || publicIp };
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const protocolUrl = protocolUrlFromArgs(argv);
    if (protocolUrl) {
      void startCapture(protocolUrl).catch(showFatalError);
      return;
    }
    if (active?.window && !active.window.isDestroyed()) {
      if (active.window.isMinimized()) active.window.restore();
      active.window.focus();
    } else {
      showReadyWindow();
    }
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (!app.isReady()) pendingProtocolUrl = url;
    else void startCapture(url).catch(showFatalError);
  });

  app.whenReady().then(async () => {
    protocolRegistered = registerProtocol();
    const protocolUrl = pendingProtocolUrl || protocolUrlFromArgs(process.argv);
    pendingProtocolUrl = null;
    if (protocolUrl) await startCapture(protocolUrl).catch(showFatalError);
    else showReadyWindow();
  });

  app.on('activate', () => {
    if (active?.window && !active.window.isDestroyed()) active.window.focus();
    else showReadyWindow();
  });
}

function showFatalError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const win = new BrowserWindow({ width: 620, height: 300, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const html = `<!doctype html><meta charset="utf-8"><title>userFLEX</title><body style="font-family:system-ui;padding:28px"><h2>No se pudo cargar la sesión</h2><p>${message.replace(/[<>&]/g, '')}</p><p>Puedes cerrar esta ventana y volver a intentarlo desde el panel. Si el problema continúa, reinstala userFLEX Session Manager.</p></body>`;
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}
