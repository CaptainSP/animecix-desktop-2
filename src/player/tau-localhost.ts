import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import * as fs from 'fs';

import { resolveAssetPath, getMimeType } from './tau-protocol';

/**
 * Loopback host serving the player. Single place of truth — the
 * certificate-error allowlist below and the request whitelist both key
 * off this exact hostname (never a suffix/prefix match).
 */
export const PLAYER_HOST = 'tau-player.localhost';

let httpServer: http.Server | null = null;
let httpsServer: https.Server | null = null;
let resolvedPort = 0;
let resolvedTlsPort = 0;

export function getPlayerPort(): number {
  return resolvedPort;
}

/** HTTPS port serving the same content (for upgraded mixed-content URLs). */
export function getPlayerTlsPort(): number {
  return resolvedTlsPort;
}

export function getPlayerBaseUrl(): string | null {
  if (!resolvedTlsPort) return null;
  return `https://${PLAYER_HOST}:${resolvedTlsPort}`;
}

/**
 * Allows the bundled self-signed certificate — and ONLY this host.
 * Without it, Chromium's automatic mixed-content upgrade turns the site's
 * `http://tau-player.localhost:PORT/...` embed into an `https://...` request
 * that dies on ERR_CERT_AUTHORITY_INVALID.
 *
 * Scope is deliberately narrow (exact hostname match, https only): this is
 * not a general certificate bypass — no setCertificateVerifyProc, no
 * --ignore-certificate-errors flag. The key lives next to the served assets
 * and is only ever used for loopback traffic on 127.0.0.1.
 *
 * Register at module scope in main.ts (before any navigation can occur),
 * not inside whenReady().
 */
export function registerPlayerCertificateHandler(): void {
  let app: typeof import('electron').app;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    app = require('electron').app;
  } catch {
    return; // Not in Electron (e.g., tests) — nothing to register.
  }
  app.on(
    'certificate-error',
    (event, _webContents, url, _error, _certificate, callback) => {
      let ours = false;
      try {
        const parsed = new URL(url);
        ours = parsed.protocol === 'https:' && parsed.hostname === PLAYER_HOST;
      } catch {
        ours = false;
      }
      if (ours) {
        event.preventDefault();
        callback(true);
        return;
      }
      callback(false);
    }
  );
}

function requestHandler(
  basePath: string
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (req, res) => {
    const pathname = new URL(req.url || '/', `http://localhost`).pathname;

    const filePath = resolveAssetPath(pathname, basePath);
    if (filePath === null) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    let resolvedFile = filePath;
    let ext = path.extname(resolvedFile);

    // SPA fallback: routes without extension serve index.html
    if (!ext) {
      resolvedFile = path.join(path.resolve(basePath), 'index.html');
      ext = '.html';
    }

    const mimeType = getMimeType(ext);

    fs.readFile(resolvedFile, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      res.writeHead(200, {
        'Content-Type': mimeType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, max-age=0',
        Pragma: 'no-cache',
      });
      res.end(data);
    });
  };
}

export function startPlayerServer(): Promise<number> {
  if (httpServer || httpsServer) return Promise.resolve(resolvedPort);

  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const { app } = require('electron') as typeof import('electron');

  const basePath = app.isPackaged
    ? path.join(process.resourcesPath, 'player')
    : path.join(app.getAppPath(), 'assets', 'player');
  // Kept OUTSIDE the served directory on purpose: the private key must
  // never be reachable over HTTP(S).
  const certBase = app.isPackaged
    ? path.join(process.resourcesPath, 'certs')
    : path.join(app.getAppPath(), 'assets', 'certs');

  let key: Buffer;
  let cert: Buffer;
  try {
    key = fs.readFileSync(path.join(certBase, 'tau-player.localhost.key'));
    cert = fs.readFileSync(path.join(certBase, 'tau-player.localhost.crt'));
  } catch (err) {
    return Promise.reject(
      new Error(`[tau-localhost] missing TLS credentials in ${certBase}: ${err}`)
    );
  }

  return new Promise((resolve, reject) => {
    const handler = requestHandler(basePath);
    httpServer = http.createServer(handler);
    httpsServer = https.createServer({ key, cert }, handler);

    // Two plain listeners: HTTP keeps serving the flows that never upgrade,
    // HTTPS (second port) serves the mixed-content-upgraded ones. The
    // upgraded URL keeps the HTTP port, so request-handler.ts redirects
    // https://<http-port>/... to this HTTPS listener (see buildTlsRedirectUrl).
    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer?.address();
      resolvedPort = typeof addr === 'object' && addr ? addr.port : 0;
      httpsServer?.listen(0, '127.0.0.1', () => {
        const tlsAddr = httpsServer?.address();
        resolvedTlsPort = typeof tlsAddr === 'object' && tlsAddr ? tlsAddr.port : 0;
        console.log(
          `[tau-localhost] Player server on http://${PLAYER_HOST}:${resolvedPort} + https://${PLAYER_HOST}:${resolvedTlsPort}`
        );
        resolve(resolvedPort);
      });
    });

    httpServer.on('error', reject);
  });
}

export function stopPlayerServer(): void {
  httpServer?.close();
  httpsServer?.close();
  httpServer = null;
  httpsServer = null;
  resolvedPort = 0;
  resolvedTlsPort = 0;
}
