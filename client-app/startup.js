import { app, Menu, dialog, nativeTheme } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

const DIRECT_UPDATE_BASE = 'https://lbvxnbbglkjnwphaomyx.supabase.co/storage/v1/object/public/userflex-client-releases';
const UPDATE_PROXY_BASE = 'https://userflex-admin.luis5afp.workers.dev/api/client-update';

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

    // Some client networks cannot reach the Supabase Storage hostname directly.
    // Keep compatibility with legacy updater URLs while routing only those reads
    // through the userFLEX Cloudflare Worker.
    const nativeFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init) => {
      const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
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
          return nativeFetch(rewritten, init);
        }
      }
      return nativeFetch(input, init);
    };

    const disableAutomaticInstallerLaunch = enableAutomaticInstallerLaunch(log);
    try {
      await import('./bootstrap.js');
      await log('bootstrap.js loaded; main lifecycle is active');
    } finally {
      disableAutomaticInstallerLaunch();
      app.setPath = nativeSetPath;
      globalThis.fetch = nativeFetch;
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

  // Do not top-level await app.whenReady(); let Electron complete its native
  // startup lifecycle while this entry module finishes evaluation normally.
  app.whenReady()
    .then(() => {
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
