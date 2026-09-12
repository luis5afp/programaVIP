import { Menu } from 'electron';

// El Client usa su propia interfaz; elimina por completo el menú nativo
// File / Edit / View / Window / Help de Electron en Windows.
Menu.setApplicationMenu(null);

await import('./main.js');
