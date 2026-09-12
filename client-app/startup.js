import { app, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

const appData = app.getPath('appData');
const legacyUserData = path.join(appData, 'userFLEX Client');
const currentUserData = app.getPath('userData');
const startupLog = path.join(legacyUserData, 'startup.log');

async function log(message) {
  try {
    await fs.mkdir(legacyUserData, { recursive: true });
    await fs.appendFile(startupLog, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
  } catch {
    // Startup logging must never prevent the app from opening.
  }
}

async function copyIdentityFile(fileName) {
  if (path.resolve(legacyUserData) === path.resolve(currentUserData)) return;
  const source = path.join(legacyUserData, fileName);
  const target = path.join(currentUserData, fileName);
  try {
    await fs.access(target);
    return;
  } catch {
    // Copy the legacy identity only when the new location does not have one yet.
  }
  try {
    await fs.mkdir(currentUserData, { recursive: true });
    await fs.copyFile(source, target);
    await log(`Migrated ${fileName} to ${currentUserData}`);
  } catch {
    // The file may not exist on a fresh install. That is expected.
  }
}

try {
  await fs.mkdir(legacyUserData, { recursive: true });
  await fs.mkdir(currentUserData, { recursive: true });
  await log(`Starting userFLOW v${app.getVersion()} from ${app.getPath('exe')}`);
  await log(`Default userData: ${currentUserData}`);
  await copyIdentityFile('device.json');
  await copyIdentityFile('auth.json');

  // v0.2.3/v0.2.4 forced Electron's userData path before readiness. On some
  // Windows installations that prevents Electron from reaching the ready state.
  // Preserve the normal Electron path and ignore only that legacy override.
  const nativeSetPath = app.setPath.bind(app);
  app.setPath = (name, value) => {
    if (name === 'userData') {
      void log(`Ignored early userData override: ${value}`);
      return;
    }
    return nativeSetPath(name, value);
  };

  const nativeWhenReady = app.whenReady.bind(app);
  app.whenReady = () => {
    void log('app.whenReady() called');
    const promise = nativeWhenReady();
    promise.then(() => log('app.whenReady() resolved')).catch((error) => log(`app.whenReady() rejected: ${error?.message || error}`));
    return promise;
  };

  await log('Importing bootstrap.js');
  await import('./bootstrap.js');
  await log('bootstrap.js completed');
} catch (error) {
  const details = error?.stack || error?.message || String(error);
  await log(`FATAL STARTUP ERROR: ${details}`);
  try {
    await app.whenReady();
    dialog.showErrorBox(
      'userFLOW no pudo iniciar',
      `Se produjo un error al iniciar userFLOW.\n\n${error?.message || 'Error desconocido'}\n\nDiagnóstico: ${startupLog}`,
    );
  } catch {
    // Nothing else can be shown if Electron itself cannot become ready.
  }
  app.quit();
}
