import { app, Menu, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

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

    try {
      await import('./bootstrap.js');
      await log('bootstrap.js loaded');
    } finally {
      app.setPath = nativeSetPath;
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
