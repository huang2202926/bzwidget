const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (config) => ipcRenderer.invoke('set-config', config),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  openAdmin: () => ipcRenderer.invoke('open-admin'),
  getAdminUrl: () => ipcRenderer.invoke('get-admin-url'),
  quit: () => ipcRenderer.invoke('quit-app'),
  onConfigChanged: (callback) => ipcRenderer.on('config-changed', (event, config) => callback(config)),
  onRefreshData: (callback) => ipcRenderer.on('refresh-data', () => callback()),
  showContextMenu: () => ipcRenderer.invoke('show-context-menu'),
  fetchApiData: (url, headers) => ipcRenderer.invoke('fetch-api-data', { url, headers })
});
