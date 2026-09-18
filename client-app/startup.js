import { app, Menu, dialog, nativeTheme, session } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startSocksHttpBridge } from './proxy-bridge.js';

const DIRECT_UPDATE_BASE = 'https://lbvxnbbglkjnwphaomyx.supabase.co/storage/v1/object/public/userflex-client-releases';
const USERFLEX_API_ORIGIN = 'https://userflex-admin.luis5afp.workers.dev';
const UPDATE_PROXY_BASE = `${USERFLEX_API_ORIGIN}/api/client-update`;
const PROFILE_ZOOM_FACTOR = 0.85;
const runtimeProxyByEndpoint = new Map();
const bridgesBySession = new WeakMap();
const openBridges = new Set();

const CLIENT_TEST_PROTOCOL = 'userflow-client://';
if (!Array.isArray(globalThis.__userflowPendingProtocolUrls)) globalThis.__userflowPendingProtocolUrls = [];

function clientProtocolUrlFromArgs(argv = []) {
  return Array.from(argv || []).find((value) => String(value || '').toLowerCase().startsWith(CLIENT_TEST_PROTOCOL)) || null;
}

function dispatchClientProtocolUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value.toLowerCase().startsWith(CLIENT_TEST_PROTOCOL)) return false;
  if (typeof globalThis.__userflowHandleProtocolUrl === 'function') {
    void Promise.resolve(globalThis.__userflowHandleProtocolUrl(value)).catch(() => null);
  } else {
    globalThis.__userflowPendingProtocolUrls.push(value);
  }
  return true;
}


function proxyEndpointKey(host, port) {
  return `${String(host || '').trim().toLowerCase()}:${Number(port || 0)}`;
}

function rememberRuntimeProxy(proxy) {
  const host = String(proxy?.host || '').trim();
  const port = Number(proxy?.port || 0);
  const type = String(proxy?.type || 'http').trim().toLowerCase();
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return;
  runtimeProxyByEndpoint.set(proxyEndpointKey(host, port), {
    host,
    port,
    type,
    username: typeof proxy?.username === 'string' ? proxy.username : '',
    password: typeof proxy?.password === 'string' ? proxy.password : '',
  });
}

function proxyRuleEndpoint(rule) {
  const match = String(rule || '').trim().match(/^http:\/\/(\[[^\]]+\]|[^/:]+):(\d+)$/i);
  if (!match) return null;
  const host = match[1].replace(/^\[|\]$/g, '');
  const port = Number(match[2]);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port };
}

function installRuntimeProxyAdapter(log) {
  const prototype = Object.getPrototypeOf(session.defaultSession);
  const nativeSetProxy = prototype?.setProxy;
  if (typeof nativeSetProxy !== 'function') return () => {};

  prototype.setProxy = async function userflexSetProxy(config = {}) {
    const previousBridge = bridgesBySession.get(this);
    if (previousBridge) {
      bridgesBySession.delete(this);
      openBridges.delete(previousBridge);
      await previousBridge.close().catch(() => null);
    }

    const endpoint = proxyRuleEndpoint(config?.proxyRules);
    const runtimeProxy = endpoint ? runtimeProxyByEndpoint.get(proxyEndpointKey(endpoint.host, endpoint.port)) : null;
    if (runtimeProxy?.type === 'socks4' || runtimeProxy?.type === 'socks5') {
      const bridge = await startSocksHttpBridge(runtimeProxy);
      bridgesBySession.set(this, bridge);
      openBridges.add(bridge);
      void log(`Proxy ${runtimeProxy.type.toUpperCase()} preparado mediante puente local seguro.`);
      return nativeSetProxy.call(this, { ...config, proxyRules: bridge.proxyRules });
    }

    if (runtimeProxy?.type === 'https' && endpoint) {
      void log('Proxy HTTPS aplicado con el protocolo detectado.');
      return nativeSetProxy.call(this, {
        ...config,
        proxyRules: `https://${endpoint.host.includes(':') ? `[${endpoint.host}]` : endpoint.host}:${endpoint.port}`,
      });
    }

    return nativeSetProxy.call(this, config);
  };

  return async () => {
    prototype.setProxy = nativeSetProxy;
    const bridges = Array.from(openBridges);
    openBridges.clear();
    await Promise.allSettled(bridges.map((bridge) => bridge.close()));
  };
}

// Capture Electron's packaged default user-data directory before changing the
// visible application name. Keep that directory fixed for every future launch
// so an update/rebrand cannot silently generate a different device identity.
const STABLE_USER_DATA = app.getPath('userData');
const LEGACY_USER_DATA = path.join(app.getPath('appData'), 'userFLEX Client');
app.setPath('userData', STABLE_USER_DATA);
app.setName('userFLOW');

// userFLOW is a dark application. Ask Electron/Windows to render native window
// chrome (title bar, caption buttons and system surfaces) in dark mode too, so
// the OS frame visually continues the app instead of showing a white strip.
nativeTheme.themeSource = 'dark';

// Every remote profile page opens at 85% so the web workspace stays compact.
// Local userFLOW surfaces (login, catalog, updater and tab chrome) keep 100%.
// Reapply the factor after navigations/reloads because some sites can reset
// their renderer zoom while changing document or origin.
app.on('web-contents-created', (_event, contents) => {
  const applyProfileZoom = () => {
    try {
      const url = contents.getURL();
      if (/^https?:\/\//i.test(url)) contents.setZoomFactor(PROFILE_ZOOM_FACTOR);
    } catch {
      // Zoom is a presentation enhancement and must never block navigation.
    }
  };
  contents.on('did-navigate', applyProfileZoom);
  contents.on('did-navigate-in-page', applyProfileZoom);
  contents.on('did-finish-load', applyProfileZoom);
});

// Keep Electron alive while bootstrap hands off from the updater splash to the
// real Client window. bootstrap.js now waits for the main window before closing
// the splash, but this guard remains as a defensive lifecycle fallback.
const bootstrapWindowHold = () => {};

function enableAutomaticInstallerLaunch(log) {
  const onWindowCreated = (_event, window) => {
    const webContents = window?.webContents;
    if (!webContents) return;

    webContents.on('did-finish-load', () => {
      void webContents.executeJavaScript(`
        (() => {
          const box = document.getElementById('update');
          const label = document.getElementById('label');
          const install = document.getElementById('install');
          if (!box || !label || !install || window.__userflowAutoInstallerObserver) return false;

          // v0.2.17+ launches the already downloaded and SHA-256 verified setup
          // automatically. Keep the old button hidden during the normal path;
          // expose it only as a fallback if Windows rejects the installer launch.
          install.hidden = true;

          const maybeLaunch = () => {
            if (!box.classList.contains('ready-install')) return;
            const message = String(label.textContent || '');
            if (message.includes('no se pudo abrir')) {
              install.hidden = false;
              return;
            }
            install.hidden = true;
            if (install.dataset.autoStarted === '1') return;
            install.dataset.autoStarted = '1';
            label.textContent = 'Actualización lista · abriendo instalador automáticamente…';
            setTimeout(() => {
              window.location.href = 'userflex-update://install';
            }, 350);
          };

          const observer = new MutationObserver(maybeLaunch);
          observer.observe(box, { attributes: true, attributeFilter: ['class'] });
          observer.observe(label, { childList: true, subtree: true, characterData: true });
          window.__userflowAutoInstallerObserver = observer;
          maybeLaunch();
          return true;
        })();
      `).then((installed) => {
        if (installed) void log('Automatic update installer launcher armed');
      }).catch((error) => {
        void log(`Automatic installer launcher injection skipped: ${error?.message || String(error)}`);
      });
    });
  };

  app.on('browser-window-created', onWindowCreated);
  return () => app.removeListener('browser-window-created', onWindowCreated);
}

async function startAfterReady() {
  Menu.setApplicationMenu(null);

  const currentUserData = app.getPath('userData');
  const legacyUserData = LEGACY_USER_DATA;
  const startupLog = path.join(currentUserData, 'startup.log');

  async function log(message) {
    try {
      await fs.mkdir(currentUserData, { recursive: true });
      await fs.appendFile(startupLog, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
    } catch {
      // Diagnostics must never block startup.
    }
  }

  async function copyIdentityFile(fileName) {
    if (path.resolve(currentUserData) === path.resolve(legacyUserData)) return;
    const source = path.join(legacyUserData, fileName);
    const target = path.join(currentUserData, fileName);
    try {
      await fs.access(target);
      return;
    } catch {
      // Copy only when the stable destination does not already exist.
    }
    try {
      await fs.mkdir(currentUserData, { recursive: true });
      await fs.copyFile(source, target);
      await log(`Migrated ${fileName} from legacy userData to ${currentUserData}`);
    } catch {
      // Fresh installs may not have legacy identity files.
    }
  }

  try {
    await log(`READY userFLOW v${app.getVersion()} from ${app.getPath('exe')}`);
    await log(`stable userData: ${currentUserData}`);
    await copyIdentityFile('device.json');
    await copyIdentityFile('auth.json');

    // bootstrap.js still contains one legacy userData compatibility call. The
    // stable path is already locked before app.whenReady(), so ignore that late
    // override and leave all other app.setPath calls untouched.
    const nativeSetPath = app.setPath.bind(app);
    app.setPath = (name, value) => {
      if (name === 'userData') {
        void log(`Ignored late userData override: ${value}`);
        return;
      }
      return nativeSetPath(name, value);
    };

    // Keep the fetch adapter active for the whole process. Besides routing the
    // updater through Cloudflare when needed, it remembers the detected proxy
    // protocol returned by /launch before main.js configures Chromium.
    const nativeFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (input, init) => {
      const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
      let requestInput = input;
      if (typeof rawUrl === 'string' && rawUrl.startsWith(DIRECT_UPDATE_BASE)) {
        const parsed = new URL(rawUrl);
        const relative = parsed.pathname.split('/userflex-client-releases/')[1] || '';
        let rewritten = null;
        if (relative === 'latest.json') {
          rewritten = `${UPDATE_PROXY_BASE}/latest?ts=${Date.now()}`;
        } else {
          const chunk = relative.match(/^versions\/([^/]+)\/(part-\d{3}\.bin)$/);
          if (chunk) rewritten = `${UPDATE_PROXY_BASE}/chunks/${encodeURIComponent(chunk[1])}/${chunk[2]}`;
        }
        if (rewritten) {
          void log(`Updater request via Cloudflare: ${relative}`);
          requestInput = rewritten;
        }
      }

      const response = await nativeFetch(requestInput, init);
      if (
        response.ok
        && typeof rawUrl === 'string'
        && rawUrl.startsWith(USERFLEX_API_ORIGIN)
        && /\/api\/client\/profiles\/[0-9a-f-]{36}\/launch(?:\?|$)/i.test(rawUrl)
      ) {
        try {
          const payload = await response.clone().json();
          rememberRuntimeProxy(payload?.connection?.proxy);
        } catch {
          // A malformed launch response will be handled by main.js itself.
        }
      }
      return response;
    };

    const disposeProxyAdapter = installRuntimeProxyAdapter(log);
    app.once('before-quit', () => {
      globalThis.fetch = nativeFetch;
      void disposeProxyAdapter();
    });

    const disableAutomaticInstallerLaunch = enableAutomaticInstallerLaunch(log);
    try {
      await import('./bootstrap.js');
      await log('bootstrap.js loaded; main lifecycle is active');
    } finally {
      disableAutomaticInstallerLaunch();
      app.setPath = nativeSetPath;
      // Do not restore global fetch here. The proxy protocol metadata is learned
      // when profiles are launched later, after bootstrap.js has finished loading.
      app.removeListener('window-all-closed', bootstrapWindowHold);
    }
  } catch (error) {
    const details = error?.stack || error?.message || String(error);
    await log(`FATAL AFTER READY: ${details}`);
    app.removeListener('window-all-closed', bootstrapWindowHold);
    dialog.showErrorBox(
      'userFLOW no pudo iniciar',
      `Se produjo un error al iniciar userFLOW.\n\n${error?.message || 'Error desconocido'}\n\nDiagnóstico: ${startupLog}`,
    );
    app.quit();
  }
}

// Keep only one userFLOW process. During an update the NSIS installer may be
// visible while the old app is still shutting down, so duplicate launches must
// exit cleanly instead of opening a second Client window.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('window-all-closed', bootstrapWindowHold);

  const initialProtocolUrl = clientProtocolUrlFromArgs(process.argv);
  if (initialProtocolUrl) dispatchClientProtocolUrl(initialProtocolUrl);

  app.on('second-instance', (_event, argv) => {
    const protocolUrl = clientProtocolUrlFromArgs(argv);
    if (protocolUrl) dispatchClientProtocolUrl(protocolUrl);
  });

  app.on('open-url', (event, rawUrl) => {
    if (!String(rawUrl || '').toLowerCase().startsWith(CLIENT_TEST_PROTOCOL)) return;
    event.preventDefault();
    dispatchClientProtocolUrl(rawUrl);
  });

  // Do not top-level await app.whenReady(); let Electron complete its native
  // startup lifecycle while this entry module finishes evaluation normally.
  app.whenReady()
    .then(() => {
      try { app.setAsDefaultProtocolClient('userflow-client'); } catch {}
      void startAfterReady();
    })
    .catch((error) => {
      try {
        app.removeListener('window-all-closed', bootstrapWindowHold);
        dialog.showErrorBox('userFLOW no pudo iniciar', error?.message || String(error));
      } finally {
        app.quit();
      }
    });
}
