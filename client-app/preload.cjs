const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('userflex', {
  bootstrap: (options) => ipcRenderer.invoke('userflex:bootstrap', options),
  login: (input) => ipcRenderer.invoke('userflex:login', input),
  logout: () => ipcRenderer.invoke('userflex:logout'),
  catalog: () => ipcRenderer.invoke('userflex:catalog'),
  launchProfile: (profileId) => ipcRenderer.invoke('userflex:launch-profile', profileId),
  onProfileImage: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('userflex:profile-image', listener);
    return () => ipcRenderer.removeListener('userflex:profile-image', listener);
  },
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
