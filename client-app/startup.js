import { app, Menu } from 'electron';

// Keep the entrypoint intentionally minimal. Nothing touches userData,
// filesystem state, updater logic, or Electron methods before ready.
await app.whenReady();
Menu.setApplicationMenu(null);
await import('./bootstrap.js');
