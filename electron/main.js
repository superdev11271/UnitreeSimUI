const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let launchWindow = null;
let mainWindow = null;
let connectionSettings = null;

function createLaunchWindow() {
  launchWindow = new BrowserWindow({
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

  launchWindow.on('closed', () => {
    launchWindow = null;
  });

  return launchWindow;
}

function createMainWindow() {
  if (mainWindow) {
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    resizable: true,
    maximizable: true,
    show: false,
    frame: false,
    backgroundColor: '#070b10',
    title: 'Unitree B2 Simulator',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../src/main/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function openMainWindow() {
  createMainWindow();

  if (launchWindow && !launchWindow.isDestroyed()) {
    launchWindow.close();
  }
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

ipcMain.handle('window:maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;

  if (win.isMaximized()) {
    win.unmaximize();
    return false;
  }

  win.maximize();
  return true;
});

ipcMain.handle('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle('connection:get-settings', () => connectionSettings);

ipcMain.handle('simulator:launch', async (_event, options) => {
  connectionSettings = options;
  openMainWindow();

  return {
    ok: true,
    message: `Connected to ROS 2 at ${options.url}`,
    options,
  };
});
