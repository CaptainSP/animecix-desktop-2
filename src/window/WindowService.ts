import { app, BrowserWindow, screen, shell } from 'electron';
import path from 'node:path';
import { StorageService } from '../storage/StorageService';
import type { TrayManager } from '../download/TrayManager';

const isMac = process.platform === 'darwin';
export const LOCAL_DEV_SITE_URL = 'http://localhost:4200';
const DEFAULT_SITE_URL = 'https://animecix.tv';

/**
 * Cloudflare Turnstile (and similar CAPTCHAs) flag User-Agents containing an
 * "Electron/…" token. Strip the Electron and app-name tokens from the default
 * UA so the underlying Chromium presents as plain Chrome, letting Turnstile
 * complete inside the app. Pure/testable — deriving from the real default UA
 * keeps the Chromium major correct across Electron upgrades.
 */
export function buildBrowserUserAgent(defaultUa: string): string {
  return defaultUa
    .replace(/ Electron\/[^\s]+/i, '')
    .replace(/(\(KHTML, like Gecko\) ).*?(Chrome\/)/i, '$1$2');
}

function getSiteUrl(): string {
  const configuredUrl = import.meta.env.VITE_SITE_URL;
  if (!configuredUrl || configuredUrl.includes('your-site.com')) {
    return DEFAULT_SITE_URL;
  }

  try {
    const parsed = new URL(configuredUrl);
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return DEFAULT_SITE_URL;
  }
}

// Debounce helper
function debounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

let isQuitting = false;

export function markQuitting(): void {
  isQuitting = true;
}

export function createWindow(storage: StorageService): BrowserWindow {
  const savedBounds = storage.getWindowBounds();

  // Validate saved bounds are within a visible display
  let x: number | undefined;
  let y: number | undefined;
  let width = savedBounds.width;
  let height = savedBounds.height;

  if (savedBounds.x !== undefined && savedBounds.y !== undefined) {
    const display = screen.getDisplayMatching({
      x: savedBounds.x,
      y: savedBounds.y,
      width: savedBounds.width,
      height: savedBounds.height,
    });
    const workArea = display.workArea;
    const isVisible =
      savedBounds.x < workArea.x + workArea.width &&
      savedBounds.x + savedBounds.width > workArea.x &&
      savedBounds.y < workArea.y + workArea.height &&
      savedBounds.y + savedBounds.height > workArea.y;

    if (isVisible) {
      x = savedBounds.x;
      y = savedBounds.y;
    }
  }

  // Fall back to defaults if no valid position
  if (x === undefined || y === undefined) {
    width = 1280;
    height = 800;
    x = undefined;
    y = undefined;
  }

  const browserWindowOptions: Electron.BrowserWindowConstructorOptions = {
    width,
    height,
    ...(x !== undefined && y !== undefined ? { x, y } : {}),
    show: false,
    backgroundColor: '#1D1D1D',
    frame: false,
    title: 'AnimeciX',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // INTENTIONAL — DO NOT CHANGE: required for cross-origin video canvas color extraction.
      // The player streams from CDN; canvas.getImageData() needs this to avoid tainted-canvas errors.
      // See OPEN-SOURCE-AUDIT.md "Intentional Bypasses §1" for full rationale.
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  };

  if (isMac) {
    // D-01: 'hiddenInset' shifts traffic lights inset and provides ~28px OS-level drag
    // strip per Electron base-window-options docs. 'hidden' (the previous value) was the
    // root cause of the missing-traffic-lights bug since the website's #appMenu (z-index
    // 999999) was visually covering the buttons. 'hiddenInset' decouples the OS chrome
    // from the website header so the buttons remain visible above content.
    browserWindowOptions.titleBarStyle = 'hiddenInset';
  } else {
    browserWindowOptions.titleBarStyle = 'hidden';
    browserWindowOptions.titleBarOverlay = {
      color: '#1D1D1D',
      symbolColor: '#ffffff',
      height: 40,
    };
  }

  const win = new BrowserWindow(browserWindowOptions);

  // Present as plain Chrome (not Electron) so Cloudflare Turnstile accepts the
  // client. The CDN's Firefox-UA override (onBeforeSendHeaders) still applies
  // per-request on top of this for tau-video.xyz/file/*.
  win.webContents.setUserAgent(
    buildBrowserUserAgent(win.webContents.getUserAgent())
  );

  // Restore maximized state
  if (savedBounds.maximized) {
    win.maximize();
  }

  // Show window when ready
  win.once('ready-to-show', () => {
    win.show();
  });

  // Dev: load local Angular dev server; Production: load website
  const siteUrl = getSiteUrl();
  const startUrl = app.isPackaged ? siteUrl : LOCAL_DEV_SITE_URL;
  void win.loadURL(startUrl);

  if (!app.isPackaged) {
    win.webContents.on('did-fail-load', (_event, _errorCode, _errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame && validatedURL.startsWith(LOCAL_DEV_SITE_URL)) {
        console.warn(`Local website dev server is unavailable at ${LOCAL_DEV_SITE_URL}; loading ${siteUrl}.`);
        void win.loadURL(siteUrl);
      }
    });
  }

  // Persist bounds on resize/move — debounced, skip while maximized
  const saveBounds = debounce(() => {
    if (win.isMaximized()) return; // Don't save maximized dimensions as restore bounds
    const bounds = win.getBounds();
    storage.saveWindowBounds({ ...bounds, maximized: false });
  }, 500);

  win.on('resize', saveBounds);
  win.on('move', saveBounds);

  // When window is un-maximized, save the restored bounds
  win.on('unmaximize', () => {
    const bounds = win.getBounds();
    storage.saveWindowBounds({ ...bounds, maximized: false });
  });

  // When maximized, persist the maximized flag (but not the inflated dimensions)
  win.on('maximize', () => {
    const bounds = win.getBounds();
    storage.saveWindowBounds({ ...bounds, maximized: true });
  });

  // Intercept popup links — open in default browser, never open new BrowserWindow
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        void shell.openExternal(url);
      }
    } catch { /* invalid URL — ignore */ }
    return { action: 'deny' };
  });

  // Restrict navigation to trusted origins — allow OAuth providers for Google login flow.
  // Google login: animecix.tv opens accounts.google.com, user authenticates,
  // Google redirects to animecix:// deeplink, app handles it via deep-link.ts.
  const SITE_HOST = new URL(siteUrl).hostname;
  win.webContents.on('will-navigate', (event, url) => {
    try {
      const parsed = new URL(url);
      const isTrusted =
        parsed.hostname === SITE_HOST ||
        parsed.hostname === 'localhost' ||
        parsed.hostname === 'accounts.google.com' ||
        parsed.hostname.endsWith('.google.com') ||
        parsed.protocol === 'tau-player:' ||
        parsed.protocol === 'animecix-library:' ||
        parsed.protocol === 'animecix-offline:';
      if (!isTrusted) {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  });

  return win;
}

export function setupCloseIntercept(
  win: BrowserWindow,
  getTrayManager: () => TrayManager | null,
): void {
  win.on('close', (event) => {
    // GUARD 1 (D-15): downloads-active hide-to-tray takes priority.
    const trayManager = getTrayManager();
    if (trayManager && trayManager.hasActiveDownloads()) {
      event.preventDefault();
      win.hide();
      trayManager.createTray();
      return;
    }

    // GUARD 2 (D-12): macOS close-to-hide. Bypassed when isQuitting is true (D-14).
    if (process.platform === 'darwin' && !isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });
}
