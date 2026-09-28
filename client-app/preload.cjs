const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('userflex', {
  bootstrap: () => ipcRenderer.invoke('userflex:bootstrap'),
  savedLogin: () => ipcRenderer.invoke('userflex:saved-login'),
  login: (input) => ipcRenderer.invoke('userflex:login', input),
  catalog: () => ipcRenderer.invoke('userflex:catalog'),
  launchProfile: (profileId) => ipcRenderer.invoke('userflex:launch-profile', profileId),
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
