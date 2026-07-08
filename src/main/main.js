'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, Menu, screen } = require('electron');
const { AirPlayReceiver } = require('./airplay/server');

const DEFAULT_W = 1100;
const DEFAULT_H = 760;

let mainWindow = null;
let receiver = null;

function createWindow() {
  // Drop the default File/Edit/View menu bar — this is a kiosk-style viewer.
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: DEFAULT_W,
    height: DEFAULT_H,
    backgroundColor: '#0b0d12',
    title: 'Phone Screen Mirror',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
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
  // Mirror video + stream lifecycle for the WebCodecs renderer. The frame's
  // `data` Buffer arrives in the renderer as a Uint8Array via structured clone.
  receiver.on('video', (frame) => toRenderer('receiver:video', frame));
  receiver.on('stream-start', (info) => toRenderer('receiver:stream-start', info));
  receiver.on('stream-stop', () => {
    toRenderer('receiver:stream-stop');
    resetWindow();
  });
  return receiver;
}

/**
 * Resize the window so the mirrored screen fills it with no wasted margins.
 * The renderer sends the video's pixel size plus the size of the surrounding
 * chrome (sidebar width + topbar height, or 0/0 in demo mode) so we can keep
 * the video area at the phone's aspect ratio. `setAspectRatio` then preserves
 * that ratio if the user drags to resize.
 */
function fitWindow({ vw, vh, extraW, extraH }) {
  if (!mainWindow || mainWindow.isDestroyed() || !vw || !vh) return;
  const wa = screen.getPrimaryDisplay().workAreaSize;
  const maxVideoH = wa.height - extraH - 60;
  const maxVideoW = wa.width - extraW - 60;
  let h = Math.min(vh, maxVideoH);
  let w = h * (vw / vh);
  if (w > maxVideoW) {
    w = maxVideoW;
    h = w * (vh / vw);
  }
  mainWindow.setAspectRatio(vw / vh, { width: extraW, height: extraH });
  mainWindow.setContentSize(Math.round(w + extraW), Math.round(h + extraH));
}

function resetWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setAspectRatio(0); // clear the lock
  mainWindow.setContentSize(DEFAULT_W, DEFAULT_H);
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

ipcMain.on('ui:fit', (_e, payload) => fitWindow(payload));

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
