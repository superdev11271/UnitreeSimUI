const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('unitreeSim', {
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onFullScreenChange: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('window:fullscreen-changed', (_event, isFullScreen) => {
      callback(Boolean(isFullScreen));
    });
  },
  getConnectionSettings: () => ipcRenderer.invoke('connection:get-settings'),
  launchSimulator: (options) => ipcRenderer.invoke('simulator:launch', options),
  readWorldModel: () => ipcRenderer.invoke('assets:read-world-model'),
  readRobotModel: () => ipcRenderer.invoke('assets:read-robot-model'),
  platform: process.platform,
});
