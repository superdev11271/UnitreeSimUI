const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('unitreeSim', {
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  launchSimulator: (options) => ipcRenderer.invoke('simulator:launch', options),
  platform: process.platform,
});
