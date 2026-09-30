// CRITICAL: Protocol imports must be FIRST — registerSchemesAsPrivileged runs at
// module top-level and MUST execute before app.whenReady() fires.
import './player/tau-protocol'; // Side-effect: registers tau-player:// scheme privileges
import { registerTauProtocol } from './player/tau-protocol';
import './offline/offline-protocol'; // Side-effect: registers animecix-offline:// scheme privileges
import { registerOfflineProtocol } from './offline/offline-protocol';
import './library/library-protocol'; // Side-effect: registers animecix-library:// scheme privileges
import { registerLibraryProtocol } from './library/library-protocol';

import { app, BrowserWindow, net } from 'electron';
import { startPlayerServer, getPlayerBaseUrl } from './player/tau-localhost';
import path from 'node:path';
import { existsSync } from 'node:fs';
import started from 'electron-squirrel-startup';
import { StorageService } from './storage/StorageService';
import { createWindow, setupCloseIntercept, markQuitting, LOCAL_DEV_SITE_URL } from './window/WindowService';
import { registerWindowIpc } from './window/window.ipc';
import { AdBlocker } from './network/ad-blocker';
import { setupRequestInterception } from './network/request-handler';
import { setupHeaderRewriter } from './network/header-rewriter';
import {
  registerDeepLinkProtocol,
  extractDeepLinkFromArgs,
  handleDeepLink,
} from './auth/deep-link';
import { DiscordService } from './integrations/discord-rpc';
import { registerDiscordIpc } from './integrations/discord.ipc';
import { DownloadQueue } from './download/DownloadQueue';
import { StreamCache } from './cache/StreamCache';
import { CacheEvictor } from './cache/CacheEvictor';
import { registerDownloadIpc } from './download/download.ipc';
import { pruneMissingDownloads } from './download/prune-missing';
import { registerCacheIpc } from './cache/cache.ipc';
import { registerPlayerIpc } from './player/player.ipc';
import { TrayManager } from './download/TrayManager';
import { UpdaterService } from './updater/UpdaterService';
import { registerUpdaterIpc } from './updater/updater.ipc';
import { UpdaterBanner } from './updater/UpdaterBanner';
import { setupWhatsNewAnnouncement } from './updater/whats-new';
import { LibraryManager } from './library/LibraryManager';
import { registerLibraryIpc } from './library/library.ipc';
import { shouldOpenLibraryOnLoadFailure } from './library/offline-fallback';

// Ignores GPU blocklist for all platforms to force hardware acceleration
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// Windows and macOS initialize WebGPU by default since Chromium 113 (No flags needed)

// Wayland WebGPU is still experimental and needs specific initialization
// Check display server first to exclude X11
if (process.platform === 'linux' && process.env.WAYLAND_DISPLAY) {
  // Force-enable graphics backends necessary for WebGPU on Linux
  app.commandLine.appendSwitch('enable-features', 'Vulkan,VulkanFromANGLE,WebGPU');
  // Unsafe flag still required on Linux — not stable/default yet
  app.commandLine.appendSwitch('enable-unsafe-webgpu');
  // explicitly force Vulkan backend since default falls back to software rendering
  app.commandLine.appendSwitch('use-angle', 'vulkan');
  // Workaround for Electron's Wayland/Vulkan incompatibility (Bug is still unsolved by Google)
  app.commandLine.appendSwitch('no-zygote');
}

// Handle Squirrel.Windows install/uninstall shortcuts
if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let storage: StorageService | null = null;
let discord: DiscordService | null = null;
let trayManager: TrayManager | null = null;
let updaterService: UpdaterService | null = null;
let updaterBanner: UpdaterBanner | null = null;
let libraryManager: LibraryManager | null = null;

// Register deep link protocol BEFORE app.ready (required by Electron)
registerDeepLinkProtocol();

// macOS: handle deep links sent via open-url event
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (mainWindow) {
    handleDeepLink(url, mainWindow.webContents);
  }
});

// Single instance lock (SHELL-02)
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  // Another instance is already running — quit immediately
  app.quit();
} else {
  // Focus existing window and forward deep links when a second instance is launched
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();

      // Forward deep link from second instance to main webContents
      const deepLinkUrl = extractDeepLinkFromArgs(argv);
      if (deepLinkUrl) {
        handleDeepLink(deepLinkUrl, mainWindow.webContents);
      }
    }
  });

  // App ready — initialize services and create window
  app.whenReady().then(() => {
    // Detect fresh installs BEFORE StorageService creates the SQLite file —
    // the whats-new announcement must only greet users who updated, never
    // first-time installers.
    const isFreshInstall = !existsSync(path.join(app.getPath('userData'), 'animecix.db'));
    storage = new StorageService();
    mainWindow = createWindow(storage);
    registerWindowIpc(mainWindow);

    // Phase 2: Register tau-player:// protocol handler (serves assets/player/)
    registerTauProtocol();

    // Start localhost HTTP server for player (WebGPU requires trustworthy origin)
    startPlayerServer().then(port => {
      if (mainWindow) {
        mainWindow.webContents.executeJavaScript(`window.__tauPlayerPort = ${port};`);
        mainWindow.webContents.on('did-finish-load', () => {
          mainWindow?.webContents.executeJavaScript(`window.__tauPlayerPort = ${port};`);
        });
      }
    }).catch(e => console.error('Failed to start player server:', e));

    // Phase 2: Network layer — ad blocker + request interception + CDN header rewriter
    const adBlocker = new AdBlocker();
    adBlocker.loadFilterLists();
    setupRequestInterception(adBlocker);
    setupHeaderRewriter();

    // Phase 2: Discord Rich Presence
    discord = new DiscordService();

    // Phase 3: Download and offline infrastructure
    const downloadsDir = path.join(app.getPath('downloads'), 'AnimeciX');
    const cacheDir = path.join(app.getPath('userData'), 'cache');

    // Register animecix-offline:// protocol handler
    registerOfflineProtocol(downloadsDir, cacheDir, storage);

    // Phase 7: Register animecix-library:// protocol handler
    registerLibraryProtocol();

    // Download queue and cache
    const queue = new DownloadQueue(storage, downloadsDir);
    const cache = new StreamCache(storage, cacheDir);
    const evictor = new CacheEvictor(storage);

    // Transparent auto-caching: intercept completed video requests (PLAY-05, D-05)
    cache.setupTransparentCaching(mainWindow.webContents.session);

    // Register cache episode lifecycle IPC
    registerCacheIpc(cache);

    // Register download/cache/storage IPC handlers
    registerDownloadIpc(mainWindow, queue, cache, storage, evictor, downloadsDir, cacheDir);

    // Drops DB records for downloads whose video file was deleted manually
    // from the downloads folder, and re-checks whenever the window regains
    // focus (the user may delete files while the app is open or minimized).
    pruneMissingDownloads(storage, downloadsDir);
    mainWindow.on('focus', () => {
      if (storage) pruneMissingDownloads(storage, downloadsDir);
    });

    // Phase 7: Library BrowserView overlay + IPC handlers
    libraryManager = new LibraryManager(mainWindow);
    registerLibraryIpc(mainWindow, storage!, libraryManager, downloadsDir);

    // System tray for background downloads
    trayManager = new TrayManager(mainWindow, queue);
    setupCloseIntercept(mainWindow, () => trayManager);

    // D-06 + D-07 (drag region) and RESEARCH.md Pitfall 5 (website-deploy lag fallback).
    //
    // Selectors:
    //   - `#appMenu` is the Angular app-bar's draggable region (rendered when website
    //     detects desktop via `window.animecix`). Already styled with `-webkit-app-region: drag`
    //     in the website's own SCSS — this injection is a redundancy / fallback.
    //   - `material-navbar:not(.transparent) .navbar-container` covers the brief moment
    //     during Angular bootstrap before `fromApp$` becomes true, AND the case where the
    //     production website hasn't yet deployed the `app-bar` styling.
    //   - `no-drag` overrides on links/buttons/inputs/[role=button]/mat-icon ensure interactive
    //     elements stay clickable inside the drag region.
    //
    // The macOS-only rule hides the website's custom min/max/close buttons (`#appMenu .col-sm-3`)
    // so users don't see them duplicated alongside the OS traffic lights while the website
    // lags behind on deploying Plan 04's Angular conditional. Plan 04 ships the matching
    // `@if (!isMac$())` template change, but production animecix.tv may serve the OLD bundle
    // for days/weeks after the desktop release. This injection is the safety net.
    //
    // RESEARCH.md "Flagged" section approves using `did-finish-load` instead of CONTEXT.md
    // D-06's `dom-ready`: both fire before Angular bootstrap (so the difference is academic
    // for our static stylesheet), AND `did-finish-load` is the established convention in
    // this file (see line 156 deep-link handler).
    //
    // RESEARCH.md Pitfall 1: `insertCSS` is cleared on every full navigation, so we use
    // `.on(...)` (recurring) and track the returned key to call `removeInsertedCSS` before
    // re-injecting — prevents stylesheet accumulation across reloads.
    //
    // RESEARCH.md Pitfall 6: `cssOrigin: 'user'` wins specificity vs the page's own
    // stylesheets per CSS cascade — guarantees the drag region works even if the website's
    // own SCSS later overrides matching selectors.
    const DRAG_REGION_CSS = process.platform === 'darwin'
      ? `
        #appMenu,
        material-navbar:not(.transparent) .navbar-container {
          -webkit-app-region: drag;
          -webkit-user-select: none;
        }
        #appMenu a, #appMenu button, #appMenu input, #appMenu [role="button"],
        material-navbar a, material-navbar button, material-navbar input,
        material-navbar [role="button"], material-navbar mat-icon {
          -webkit-app-region: no-drag;
        }
        /* macOS-only: hide the website's custom right-column min/max/close buttons.
           Pairs with Plan 04's @if (!isMac$()) template guard but ships independently
           so users don't see double controls during the website-deploy lag window. */
        #appMenu .col-sm-3 {
          display: none !important;
        }
        /* Offset left column so it clears the traffic lights (~78px inset) */
        #appMenu .col-sm-9,
        material-navbar .navbar-container .col-sm-9 {
          padding-left: 78px !important;
        }
      `
      : `
        #appMenu,
        material-navbar:not(.transparent) .navbar-container {
          -webkit-app-region: drag;
          -webkit-user-select: none;
        }
        #appMenu a, #appMenu button, #appMenu input, #appMenu [role="button"],
        material-navbar a, material-navbar button, material-navbar input,
        material-navbar [role="button"], material-navbar mat-icon {
          -webkit-app-region: no-drag;
        }
      `;

    let dragCssKey: string | null = null;
    mainWindow.webContents.on('did-finish-load', async () => {
      // Remove the previous injection (if any) to avoid accumulation across reloads.
      if (dragCssKey && mainWindow) {
        try {
          await mainWindow.webContents.removeInsertedCSS(dragCssKey);
        } catch {
          // Ignore — key may have been auto-cleared by Electron on full navigation.
        }
      }
      if (mainWindow) {
        // cssOrigin: 'user' wins specificity vs the page's own author-origin stylesheets.
        dragCssKey = await mainWindow.webContents.insertCSS(DRAG_REGION_CSS, { cssOrigin: 'user' });
      }
    });

    // Auto-destroy tray when all downloads complete
    queue.on('queueEmpty', () => {
      if (trayManager?.isActive()) {
        trayManager.showWindow();
      }
    });

    // Per D-04: Auto-show library when app opens with no internet.
    // net.isOnline() is only a fast path — it can report "online" while the
    // site is unreachable (e.g. router up but no WAN). The did-fail-load
    // handler below is the authoritative fallback: a network-level failure
    // of the main frame means the website cannot be reached, so we drop
    // into the offline library instead of showing a blank window.
    if (!net.isOnline()) {
      libraryManager.show();
    }

    mainWindow.webContents.on(
      'did-fail-load',
      (_event, errorCode, _errorDescription, validatedURL, isMainFrame) => {
        if (
          shouldOpenLibraryOnLoadFailure({
            errorCode,
            isMainFrame,
            validatedURL,
            devSiteURL: LOCAL_DEV_SITE_URL,
            isPackaged: app.isPackaged,
            libraryVisible: libraryManager.isVisible(),
          })
        ) {
          console.warn(`[main] Website unreachable (${errorCode}); opening offline library.`);
          libraryManager.show();
        }
      },
    );

    // Phase 4: Auto-update via electron-updater
    updaterService = new UpdaterService();
    updaterService.init();
    registerUpdaterIpc(updaterService, () => mainWindow);

    // Wire tray "Güncellemeleri kontrol et" menu item
    trayManager.setUpdaterService(updaterService);

    // In-app banner overlay for update-downloaded event
    updaterBanner = new UpdaterBanner(mainWindow, updaterService);

    // What's-new announcement — greets users who updated the app (never fresh
    // installs) with a summary of new features, once per version.
    setupWhatsNewAnnouncement(mainWindow, storage, isFreshInstall);

    // Phase 2: Handle buffered deep link from cold start (process.argv)
    const bufferedUrl = extractDeepLinkFromArgs(process.argv);
    if (bufferedUrl && mainWindow) {
      // Wait for the page to finish loading before navigating to callback URL
      mainWindow.webContents.once('did-finish-load', () => {
        handleDeepLink(bufferedUrl, mainWindow!.webContents);
      });
    }

    // Register video:fetch and subtitle preference IPC handlers
    registerPlayerIpc(storage);

    // Register Discord RPC episode lifecycle IPC handlers
    registerDiscordIpc(() => discord);
  }).catch((err) => {
    console.error('Failed to initialize app:', err);
    app.quit();
  });

  // Non-macOS: quit when all windows closed — but stay alive if tray is active (downloads running)
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      if (!trayManager || !trayManager.isActive()) {
        storage?.close();
        storage = null;
        app.quit();
      }
    }
  });

  // D-13: macOS dock-icon re-show. Hidden windows count in getAllWindows(),
  // so the old length-check missed them (RESEARCH.md Pitfall 4).
  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    } else if (storage) {
      mainWindow = createWindow(storage);
      registerWindowIpc(mainWindow);
    }
  });

  // Clean shutdown — destroy tray, Discord RPC, close StorageService before quitting
  app.on('before-quit', () => {
    // D-14: set quit flag FIRST so subsequent close events skip macOS hide-on-close.
    markQuitting();

    // T-4-04 mitigation: dispose updater timers before quit to avoid file-lock races
    updaterService?.dispose();
    updaterService = null;
    updaterBanner?.dispose();
    updaterBanner = null;
    libraryManager?.dispose();
    libraryManager = null;
    trayManager?.destroyTray();
    trayManager = null;
    discord?.destroy();
    discord = null;
    storage?.close();
    storage = null;
  });
}
