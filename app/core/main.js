/**
 * BarcodeGames host app — Electron main process (shared by Linux, Windows and Mac builds).
 *
 * Games live in games/<id>/ and are served over a custom barcode:// protocol rather than
 * file://, so fetch() and canvas pixel reads (texture baking) work like on a real website.
 *
 * Flags:
 *   --local-server   connect to ws://localhost:8787 instead of wss://api.barcodegames.fun
 *   --game=<id>      which game to open (until there's a launcher)
 */

const { app, BrowserWindow, protocol, net, ipcMain } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = __dirname;
const DEFAULT_GAME = 'dying-to-know';

const args = process.argv.slice(1);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const flagValue = (name) => (flag(name) || '').split('=')[1];

const config = {
  serverUrl: process.env.BARCODE_SERVER
    || (flag('local-server') ? 'ws://localhost:8787' : 'wss://api.barcodegames.fun'),
  joinUrl: 'barcodegames.fun',
  platform: process.platform,
  version: app.getVersion(),
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'barcode', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function serveAppFiles() {
  // barcode://app/<path> → <ROOT>/<path>, refusing anything outside ROOT
  protocol.handle('barcode', (req) => {
    const { pathname } = new URL(req.url);
    const filePath = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
    if (!filePath.startsWith(ROOT + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#000000',
    title: 'BarcodeGames',
    autoHideMenuBar: true, // Alt shows it (dev tools, reload, fullscreen)
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required', // game audio starts without a click
    },
  });

  const game = flagValue('game') || DEFAULT_GAME;
  win.loadURL(`barcode://app/games/${game}/index.html`);
}

ipcMain.on('barcode:config', (e) => { e.returnValue = config; });

app.whenReady().then(() => {
  serveAppFiles();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
