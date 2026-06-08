const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

function createLaunchWindow() {
  const launchWindow = new BrowserWindow({
    width: 800,
    height: 500,
    minWidth: 640,
    minHeight: 420,
    resizable: true,
    maximizable: false,
    show: false,
    frame: false,
    backgroundColor: '#070b10',
    title: 'Unitree B2 Gazebo Simulator',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  launchWindow.loadFile(path.join(__dirname, '../src/launch/index.html'));

  launchWindow.once('ready-to-show', () => {
    launchWindow.show();
  });

  return launchWindow;
}

app.whenReady().then(() => {
  createLaunchWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createLaunchWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.handle('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle('simulator:launch', async (_event, options) => {
  return {
    ok: true,
    message: `Connected to ROS 2 at ${options.url}`,
    options,
  };
});
