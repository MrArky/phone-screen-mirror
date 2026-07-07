'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { AirPlayReceiver } = require('./airplay/server');

let mainWindow = null;
let receiver = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    backgroundColor: '#0b0d12',
    title: 'Phone Screen Mirror',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** Push a log line to the renderer if the window is alive. */
function toRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function buildReceiver() {
  receiver = new AirPlayReceiver({ name: 'PC Screen Mirror' });
  receiver.on('log', (msg) => toRenderer('receiver:log', msg));
  receiver.on('status', (status) => toRenderer('receiver:status', status));
  return receiver;
}

// --- IPC from renderer ---------------------------------------------------
ipcMain.handle('receiver:start', async () => {
  if (!receiver) buildReceiver();
  await receiver.start();
  return { ok: true };
});

ipcMain.handle('receiver:stop', async () => {
  if (receiver) receiver.stop();
  return { ok: true };
});

// --- App lifecycle -------------------------------------------------------
app.whenReady().then(() => {
  createWindow();
  // Auto-start the receiver so the device is discoverable as soon as the app opens.
  buildReceiver()
    .start()
    .catch((err) => toRenderer('receiver:log', `[receiver] start error: ${err.message}`));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (receiver) receiver.stop();
  if (process.platform !== 'darwin') app.quit();
});
