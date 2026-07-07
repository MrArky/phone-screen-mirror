'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Safe bridge between the sandboxed renderer and the main process.
 * The renderer can start/stop the receiver and subscribe to log/status events.
 */
contextBridge.exposeInMainWorld('mirror', {
  start: () => ipcRenderer.invoke('receiver:start'),
  stop: () => ipcRenderer.invoke('receiver:stop'),
  onLog: (cb) => ipcRenderer.on('receiver:log', (_e, msg) => cb(msg)),
  onStatus: (cb) => ipcRenderer.on('receiver:status', (_e, status) => cb(status)),
});
