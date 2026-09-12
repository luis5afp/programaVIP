import { app, Menu } from 'electron';

// El Client usa su propia interfaz; elimina por completo el menú nativo
// File / Edit / View / Window / Help de Electron en Windows antes de crear ventanas.
await app.whenReady();
Menu.setApplicationMenu(null);

await import('./main.js');
