import { app, Menu } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

// Critical rule: do not touch filesystem state, userData, updater logic, or
// Electron methods before ready. This is the same startup pattern that worked
// in the early Client builds.
await app.whenReady();
Menu.setApplicationMenu(null);

// After Electron is ready, preserve only the client identity files from the
// legacy folder. Chromium profile data is not moved here; managed sessions are
// restored by the server when a profile opens.
const currentUserData = app.getPath('userData');
const legacyUserData = path.join(app.getPath('appData'), 'userFLEX Client');

async function copyIdentityFile(fileName) {
  if (path.resolve(currentUserData) === path.resolve(legacyUserData)) return;
  const source = path.join(legacyUserData, fileName);
  const target = path.join(currentUserData, fileName);
  try {
    await fs.access(target);
    return;
  } catch {
    // Copy only when the new location does not already have this identity file.
  }
  try {
    await fs.mkdir(currentUserData, { recursive: true });
    await fs.copyFile(source, target);
  } catch {
    // Fresh installs may not have legacy identity files.
  }
}

await copyIdentityFile('device.json');
await copyIdentityFile('auth.json');

// bootstrap.js still contains the old compatibility call that tries to force
// userData back to the legacy folder. Ignore only that call now that Electron
// is already ready, then restore Electron's native method after bootstrap.
const nativeSetPath = app.setPath.bind(app);
app.setPath = (name, value) => {
  if (name === 'userData') return;
  return nativeSetPath(name, value);
};

try {
  await import('./bootstrap.js');
} finally {
  app.setPath = nativeSetPath;
}
