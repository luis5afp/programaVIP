import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let active = null;
let pendingProtocolUrl = null;

function protocolUrlFromArgs(args) {
  return args.find((arg) => typeof arg === 'string' && arg.startsWith('userflex-session://')) || null;
}

function registerProtocol() {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('userflex-session', process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient('userflex-session');
  }
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
  try {
    const response = await browserSession.fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
    if (!response.ok) return null;
    const payload = await response.json();
    return typeof payload?.ip === 'string' ? payload.ip : null;
  } catch {
    return null;
  }
}

async function startCapture(rawUrl) {
  const { endpoint, token } = assertCaptureUrl(rawUrl);
  const bootstrap = await apiPost(endpoint, '/api/session-manager/bootstrap', { token });
  const profile = bootstrap.profile;
  const credentials = bootstrap.credentials;
  const proxy = bootstrap.proxy;
  if (!profile?.id || !profile?.url || !proxy?.host || !proxy?.port) throw new Error('Configuración incompleta.');

  if (active?.window && !active.window.isDestroyed()) active.window.close();

  const partition = `persist:userflex-profile-${profile.id}`;
  const browserWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 650,
    title: `userFLEX · ${profile.name}`,
    webPreferences: {
      partition,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: false,
    },
  });

  const browserSession = browserWindow.webContents.session;
  await browserSession.setProxy({
    mode: 'fixed_servers',
    proxyRules: `http://${proxy.host}:${proxy.port}`,
    proxyBypassRules: '<-loopback>',
  });

  const loginHandler = (event, webContents, request, authInfo, callback) => {
    if (webContents.id !== browserWindow.webContents.id || !authInfo.isProxy) return;
    event.preventDefault();
    callback(proxy.username || '', proxy.password || '');
  };
  app.on('login', loginHandler);

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
    app.removeListener('login', loginHandler);
    if (active?.window === browserWindow) active = null;
  });

  active = {
    endpoint,
    token,
    profile,
    browserWindow,
    window: browserWindow,
    browserSession,
    allowedOrigin,
  };

  await browserWindow.loadURL(profile.url);
}

ipcMain.handle('userflex:save-session', async (event) => {
  if (!active || event.sender.id !== active.browserWindow.webContents.id) throw new Error('No hay captura activa.');
  const { browserWindow, browserSession, endpoint, token, allowedOrigin, profile } = active;
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
  const material = {
    format: 'userflex-browser-session-v1',
    profileId: profile.id,
    allowedOrigin,
    capturedUrl: currentUrl,
    capturedAt: new Date().toISOString(),
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
    if (protocolUrl) void startCapture(protocolUrl).catch(showFatalError);
    if (active?.window && !active.window.isDestroyed()) {
      if (active.window.isMinimized()) active.window.restore();
      active.window.focus();
    }
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (!app.isReady()) pendingProtocolUrl = url;
    else void startCapture(url).catch(showFatalError);
  });

  app.whenReady().then(async () => {
    registerProtocol();
    const protocolUrl = pendingProtocolUrl || protocolUrlFromArgs(process.argv);
    pendingProtocolUrl = null;
    if (protocolUrl) await startCapture(protocolUrl).catch(showFatalError);
  });
}

function showFatalError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const win = new BrowserWindow({ width: 620, height: 260, webPreferences: { sandbox: true } });
  const html = `<!doctype html><meta charset="utf-8"><title>userFLEX</title><body style="font-family:system-ui;padding:28px"><h2>No se pudo cargar la sesión</h2><p>${message.replace(/[<>&]/g, '')}</p><p>Puedes cerrar esta ventana y volver a intentarlo desde el panel.</p></body>`;
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}
