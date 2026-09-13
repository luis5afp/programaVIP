const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('userflexProfileWindow', {
  getState: () => ipcRenderer.invoke('userflex-profile-window:get-state'),
  action: (action, payload = {}) => ipcRenderer.invoke('userflex-profile-window:action', { action, ...payload }),
  onState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('userflex-profile-window:state', listener);
    return () => ipcRenderer.removeListener('userflex-profile-window:state', listener);
  },
});
