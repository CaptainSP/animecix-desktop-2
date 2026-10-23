import { AdBlocker } from './ad-blocker';
import { getPlayerBaseUrl, getPlayerPort, getPlayerTlsPort, PLAYER_HOST } from '../player/tau-localhost';

// First-party domains that must never be blocked
const SITE_DOMAIN = new URL(import.meta.env.VITE_SITE_URL).hostname;
const CDN_DOMAIN = import.meta.env.VITE_CDN_DOMAIN;
const WHITELIST_PATTERNS = [SITE_DOMAIN, CDN_DOMAIN, 'localhost', 'tau-player.localhost'];

/**
 * Pure function: returns true if the URL should be redirected from the
 * tau-video.xyz embed page to the local tau-player:// protocol handler.
 * Only matches https://tau-video.xyz/embed/* and https://tau-video.xyz/embed-2/*
 */
export function isIframeRedirect(url: string): boolean {
  const base = import.meta.env.VITE_API_BASE_URL;
  return (
    url.startsWith(base + '/embed/') ||
    url.startsWith(base + '/embed-2/')
  );
}

/**
 * Pure function: converts a tau-video.xyz embed URL to the local player URL.
 * Preserves the full pathname and query string. Prefers the localhost server
 * base (https, same port answers plain HTTP too) with tau-player:// fallback
 * when the server is not running (e.g., in unit tests).
 *
 * e.g. https://tau-video.xyz/embed/abc123?vid=1 -> https://tau-player.localhost:PORT/embed/abc123?vid=1
 */
export function buildRedirectUrl(url: string): string {
  const parsed = new URL(url);
  const base = getPlayerBaseUrl();
  if (base) {
    return `${base}${parsed.pathname}${parsed.search}`;
  }
  return `tau-player://bundle${parsed.pathname}${parsed.search}`;
}

/**
 * Pure function: maps an upgraded mixed-content player URL to the real TLS
 * listener. Chromium keeps the HTTP port when it upgrades the site's
 * `http://tau-player.localhost:PORT/...` embed to https, but TLS lives on a
 * different port — without this redirect the handshake hits the plain-HTTP
 * listener and the iframe dies. Returns null for anything that is not
 * exactly that shape (different host, already on the TLS port, ports
 * unknown/not started), so it can never loop or hijack foreign URLs.
 */
export function buildTlsRedirectUrl(url: string, httpPort: number, tlsPort: number): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== PLAYER_HOST) return null;
  if (!httpPort || !tlsPort || httpPort === tlsPort) return null;
  if (parsed.port !== String(httpPort)) return null;
  parsed.port = String(tlsPort);
  return parsed.toString();
}

/**
 * Returns true if the URL belongs to a first-party domain that must not be blocked.
 */
function isFirstParty(url: string): boolean {
  return WHITELIST_PATTERNS.some((pattern) => url.includes(pattern));
}

/**
 * Registers the single combined onBeforeRequest handler on the default session.
 * Order of checks:
 *   0. Upgraded player embed (https://tau-player.localhost:<http-port>/* ->
 *      https://tau-player.localhost:<tls-port>/*) — must run before the
 *      whitelist below would wave it through to the wrong listener
 *   1. Iframe redirect (tau-video.xyz/embed/* -> local player URL)
 *   2. First-party whitelist (animecix.tv, tau-video.xyz) -> pass through
 *   3. Ad blocker -> cancel if matched
 *   4. Pass through
 *
 * CRITICAL: Electron replaces the handler on each call to onBeforeRequest.
 * Only ONE handler must be registered — this function is the single registration point.
 */
export function setupRequestInterception(adBlocker: AdBlocker): void {
  // Guard: only run in Electron environment
  let session: typeof import('electron').Session;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as typeof import('electron');
    session = electron.session;
  } catch {
    // Not in Electron (e.g., tests) — skip registration
    return;
  }

  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['*://*/*'] },
    (
      details: Electron.OnBeforeRequestListenerDetails,
      callback: (response: Electron.Response) => void
    ) => {
      const { url } = details;

      // 0. Upgraded player embed — redirect to the real TLS listener before
      // the whitelist below would wave it through to the plain-HTTP one.
      const tlsRedirect = buildTlsRedirectUrl(url, getPlayerPort(), getPlayerTlsPort());
      if (tlsRedirect) {
        callback({ redirectURL: tlsRedirect });
        return;
      }

      // 1. Iframe redirect
      if (isIframeRedirect(url)) {
        callback({ redirectURL: buildRedirectUrl(url) });
        return;
      }

      // 2. First-party whitelist — never block animecix.tv or tau-video.xyz
      if (isFirstParty(url)) {
        callback({});
        return;
      }

      // 3. Ad blocker
      if (adBlocker.shouldBlock(url)) {
        callback({ cancel: true });
        return;
      }

      // 4. Pass through
      callback({});
    }
  );
}
