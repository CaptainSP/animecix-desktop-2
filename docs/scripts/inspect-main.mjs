// Electron main for inspecting the player page in isolation (no website).
// Serves assets/player/ via tau-player:// and loads the player page directly.
// Launch via: npx electron docs/scripts/inspect-main.mjs
import { app, BrowserWindow, protocol, net } from 'electron';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'tau-player',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

app.whenReady().then(async () => {
  const basePath = path.join(root, 'assets', 'player');

  protocol.handle('tau-player', async (request) => {
    const url = new URL(request.url);
    let p = url.pathname;
    if (p === '/' || p === '') p = '/index.html';
    const filePath0 = path.join(basePath, p);
    const ext0 = path.extname(filePath0);
    const filePath = ext0 ? filePath0 : path.join(basePath, 'index.html');
    const mime = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.woff2': 'font/woff2',
      '.svg': 'image/svg+xml',
    }[path.extname(filePath)] || 'application/octet-stream';
    console.log(`[protocol] ${request.url} -> ${filePath} (${mime})`);
    try {
      const r = await net.fetch(pathToFileURL(filePath).toString());
      const body = await r.arrayBuffer();
      return new Response(body, {
        status: r.status,
        headers: { 'Content-Type': mime },
      });
    } catch (e) {
      console.log(`[protocol] 404 for ${request.url}: ${e.message}`);
      return new Response('Not Found', { status: 404 });
    }
  });

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,
    webPreferences: {
      webSecurity: false,
    },
  });
  win.webContents.on('console-message', (_e, level, message) => {
    console.log(`[renderer:${level}] ${message}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.log('RENDERER GONE:', JSON.stringify(details));
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.log('FAILED LOAD:', code, desc);
  });
  await win.loadURL('tau-player://player/embed/inspect');
});
