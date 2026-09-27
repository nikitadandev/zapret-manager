const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('zapretManager', {
  snapshot: () => ipcRenderer.invoke('manager:snapshot'),
  probe: () => ipcRenderer.invoke('manager:probe'),
  start: (strategy) => ipcRenderer.invoke('manager:start', strategy),
  stop: () => ipcRenderer.invoke('manager:stop'),
  update: () => ipcRenderer.invoke('manager:update'),
  autoTune: () => ipcRenderer.invoke('manager:auto-tune'),
  cancelTune: () => ipcRenderer.invoke('manager:cancel-tune'),
  getSettings: () => ipcRenderer.invoke('manager:get-settings'),
  updateSettings: (settings) => ipcRenderer.invoke('manager:update-settings', settings),
  checkManagerUpdate: () => ipcRenderer.invoke('manager:check-app-update'),
  downloadManagerUpdate: () => ipcRenderer.invoke('manager:download-app-update'),
  installManagerUpdate: () => ipcRenderer.invoke('manager:install-app-update'),
  openExternal: (url) => ipcRenderer.invoke('manager:open-external', url),
  onTuneProgress: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('manager:tune-progress', listener)
    return () => ipcRenderer.removeListener('manager:tune-progress', listener)
  },
  onStateChanged: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('manager:state-changed', listener)
    return () => ipcRenderer.removeListener('manager:state-changed', listener)
  },
})
