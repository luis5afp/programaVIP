const { contextBridge, ipcRenderer } = require('electron');
const { version } = require('./package.json');

contextBridge.exposeInMainWorld('userflex', {
  version,
  bootstrap: () => ipcRenderer.invoke('userflex:bootstrap'),
  login: (input) => ipcRenderer.invoke('userflex:login', input),
  catalog: () => ipcRenderer.invoke('userflex:catalog'),
  launchProfile: (profileId) => ipcRenderer.invoke('userflex:launch-profile', profileId),
  logout: () => ipcRenderer.invoke('userflex:logout'),
  onHeartbeat: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('userflex:heartbeat', listener);
    return () => ipcRenderer.removeListener('userflex:heartbeat', listener);
  },
  onAuthInvalidated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('userflex:auth-invalidated', listener);
    return () => ipcRenderer.removeListener('userflex:auth-invalidated', listener);
  },
});
