const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('unitreeSim', {
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  getConnectionSettings: () => ipcRenderer.invoke('connection:get-settings'),
  launchSimulator: (options) => ipcRenderer.invoke('simulator:launch', options),
  readWorldModel: () => ipcRenderer.invoke('assets:read-world-model'),
  platform: process.platform,
});
