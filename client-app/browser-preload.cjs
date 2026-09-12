const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('userflexBrowser', {
  getState: () => ipcRenderer.invoke('userflex-browser:get-state'),
  action: (action, profileId) => ipcRenderer.invoke('userflex-browser:action', { action, profileId }),
  onState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('userflex-browser:state', listener);
    return () => ipcRenderer.removeListener('userflex-browser:state', listener);
  },
});
