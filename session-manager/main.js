import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { createKaizenCaptureEngine } from './browser-engine/kaizen-capture-engine.js';

let readyWindow = null;
let pendingProtocolUrl = null;
let protocolRegistered = false;
let captureEngine = null;

function engine() {
  if (!captureEngine) captureEngine = createKaizenCaptureEngine({ app, log: console });
  return captureEngine;
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
    headers: { 'content-type': 'application/json' },
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

async function startCapture(rawUrl) {
  const { endpoint, token } = assertCaptureUrl(rawUrl);
  const bootstrap = await apiPost(endpoint, '/api/session-manager/bootstrap', { token });
  const profile = bootstrap.profile;
  const credentials = bootstrap.credentials;
  const proxy = bootstrap.proxy || null;

  if (!profile?.id || !profile?.url || !credentials?.username || !credentials?.password) {
    throw new Error('La configuración de captura está incompleta.');
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

  console.log(
    `Session Manager KAIZEN launched ${profile.name || profile.id} `
    + `pid=${result.pid} debugPort=${result.debugPort} `
    + `network=${proxy ? 'proxy' : 'direct'}.`,
  );
  return result;
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
      void startCapture(protocolUrl).catch(showFatalError);
      return;
    }
    showReadyWindow();
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
    if (!engine().active) showReadyWindow();
  });

  app.on('before-quit', () => {
    void engine().close('app_exit').catch(() => null);
  });
}
