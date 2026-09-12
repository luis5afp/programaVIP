import { app, Menu, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

const DIRECT_UPDATE_BASE = 'https://lbvxnbbglkjnwphaomyx.supabase.co/storage/v1/object/public/userflex-client-releases';
const UPDATE_PROXY_BASE = 'https://userflex-admin.luis5afp.workers.dev/api/client-update';

async function startAfterReady() {
  Menu.setApplicationMenu(null);

  const currentUserData = app.getPath('userData');
  const legacyUserData = path.join(app.getPath('appData'), 'userFLEX Client');
  const startupLog = path.join(legacyUserData, 'startup.log');

  async function log(message) {
    try {
      await fs.mkdir(legacyUserData, { recursive: true });
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
      // Copy only when the destination does not already exist.
    }
    try {
      await fs.mkdir(currentUserData, { recursive: true });
      await fs.copyFile(source, target);
      await log(`Migrated ${fileName} to ${currentUserData}`);
    } catch {
      // Fresh installs may not have legacy identity files.
    }
  }

  try {
    await log(`READY userFLOW v${app.getVersion()} from ${app.getPath('exe')}`);
    await log(`userData: ${currentUserData}`);
    await copyIdentityFile('device.json');
    await copyIdentityFile('auth.json');

    // bootstrap.js still contains one legacy userData compatibility call.
    // Electron is already ready here, so ignore only that call and leave all
    // other app.setPath uses untouched.
    const nativeSetPath = app.setPath.bind(app);
    app.setPath = (name, value) => {
      if (name === 'userData') {
        void log(`Ignored legacy userData override after ready: ${value}`);
        return;
      }
      return nativeSetPath(name, value);
    };

    // Some client networks cannot reach the Supabase Storage hostname directly.
    // Keep the updater implementation unchanged, but transparently route only
    // its manifest/chunk reads through the userFLEX Cloudflare Worker.
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

    try {
      await import('./bootstrap.js');
      await log('bootstrap.js loaded');
    } finally {
      app.setPath = nativeSetPath;
      globalThis.fetch = nativeFetch;
    }
  } catch (error) {
    const details = error?.stack || error?.message || String(error);
    await log(`FATAL AFTER READY: ${details}`);
    dialog.showErrorBox(
      'userFLOW no pudo iniciar',
      `Se produjo un error al iniciar userFLOW.\n\n${error?.message || 'Error desconocido'}\n\nDiagnóstico: ${startupLog}`,
    );
    app.quit();
  }
}

// Keep only one userFLOW process. During an automatic update the NSIS installer
// now relaunches the app itself; the legacy updater helper may also attempt a
// fallback launch, so a second instance must exit cleanly instead of opening a
// duplicate window.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  // Important: do not top-level await app.whenReady(). The early working Client
  // builds used this promise pattern. It lets the entry module finish evaluating
  // immediately while Electron continues its normal initialization.
  app.whenReady()
    .then(() => {
      void startAfterReady();
    })
    .catch((error) => {
      try {
        dialog.showErrorBox('userFLOW no pudo iniciar', error?.message || String(error));
      } finally {
        app.quit();
      }
    });
}
