/**
 * Exposes app config to games as window.barcode (server URL, join URL, platform).
 * Games must also run without it (e.g. opened in a browser during development).
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('barcode', ipcRenderer.sendSync('barcode:config'));
