import { app, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

const legacyUserData = path.join(app.getPath('appData'), 'userFLEX Client');
const startupLog = path.join(legacyUserData, 'startup.log');

async function log(message) {
  try {
    await fs.mkdir(legacyUserData, { recursive: true });
    await fs.appendFile(startupLog, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
  } catch {
    // Startup logging must never prevent the app from opening.
  }
}

try {
  await fs.mkdir(legacyUserData, { recursive: true });
  app.setPath('userData', legacyUserData);
  await log(`Starting userFLOW v${app.getVersion()} from ${app.getPath('exe')}`);
  await import('./bootstrap.js');
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
