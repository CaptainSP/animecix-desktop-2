// Preload script — implements contextBridge.exposeInMainWorld('animecix', ...)
// This is the ONLY communication channel between renderer (animecix.tv) and main process.
// ipcRenderer is never exposed directly — all calls are wrapped per AnimecixAPI contract.
// See: animecix-v2/src/types/animecix-api.d.ts

import { contextBridge, ipcRenderer } from 'electron';
import type { AnimecixAPI, DownloadProgress, PushNotification } from './types/animecix-api';
import { PUSH_CHANNELS } from './notifications/push.types';
import { UPDATER_CHANNELS } from './types/updater.js';
import type { UpdateReadyPayload, DownloadProgressPayload, UpdaterApi } from './types/updater.js';

function appendPlayerCacheBust(pathname: string, search: string): string {
  const pathAndSearch = `${pathname}${search}`;
  if (!import.meta.env.DEV) {
    return pathAndSearch;
  }

  const separator = search ? '&' : '?';
  return `${pathAndSearch}${separator}desktopPlayerBuild=${Date.now()}`;
}

const api: AnimecixAPI = {
  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  setFullscreen: (fullscreen: boolean) => ipcRenderer.invoke('window:setFullscreen', fullscreen),

  // Fullscreen event subscription — returns unsubscribe function
  onFullscreenChange: (cb: (isFullscreen: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isFullscreen: boolean) => {
      cb(isFullscreen);
    };
    ipcRenderer.on('window:fullscreen-changed', handler);
    // Return unsubscribe function
    return () => {
      ipcRenderer.removeListener('window:fullscreen-changed', handler);
    };
  },

  // Platform info — synchronous, set at preload time
  platform: process.platform,
  version: process.env.npm_package_version,

  // Network status — synchronous
  isOnline: () => navigator.onLine,

  // Open URL in system default browser (used by Angular for Google OAuth login)
  openLink: (url: string) => ipcRenderer.invoke('window:openLink', url),

  // Keep the display awake while an episode plays. Called by animecix.tv on the
  // player's play/pause postMessages, and by the player page itself during
  // offline playback (where it is the top-level document, so it has the bridge).
  // Chromium's built-in video wake lock is tied to the <video> staying visible,
  // which the iframe in a scrollable watch page cannot promise.
  setKeepAwake: (enabled: boolean) => ipcRenderer.invoke('power:setKeepAwake', enabled),

  // --- Video data pre-fetch (fast path for tau-video sources) ---
  // Website calls fetchVideoData BEFORE loading the player iframe.
  // Main process fetches from tau-video.xyz API (no CORS, Node.js net module).
  // Website then opens iframe with tau-player:// URL and passes data via postMessage.
  // This eliminates the player's own API fetch, cutting ~200-500ms from load time.
  fetchVideoData: (id: string, vid?: string) => ipcRenderer.invoke('video:fetch', id, vid),

  // Converts a tau-video.xyz embed URL to the local player URL.
  // Prefers http://tau-player.localhost:PORT (WebGPU support) with tau-player:// fallback.
  getPlayerUrl: (embedUrl: string): string | null => {
    try {
      const parsed = new URL(embedUrl);
      if (parsed.hostname === import.meta.env.VITE_CDN_DOMAIN && (parsed.pathname.startsWith('/embed/') || parsed.pathname.startsWith('/embed-2/'))) {
        const playerPath = appendPlayerCacheBust(parsed.pathname, parsed.search);
        const port = (window as any).__tauPlayerPort;
        if (port) {
          return `http://tau-player.localhost:${port}${playerPath}`;
        }
        return `tau-player://bundle${playerPath}`;
      }
    } catch { /* invalid URL */ }
    return null;
  },

  // --- Subtitle preferences (Phase 2) ---
  // Called by animecix.tv website (NOT by the player iframe).
  // animecix.tv is the bridge between player iframe (postMessage) and SQLite (IPC):
  //   - On episode load: animecix.tv calls getSubtitlePref -> gets saved lang
  //     -> sends changeSub postMessage to player iframe to apply the preference
  //   - On caption change: player sends captionsChanged postMessage to animecix.tv
  //     -> animecix.tv calls setSubtitlePref to persist the new preference to SQLite
  getSubtitlePref: (animeId: string) => ipcRenderer.invoke('subtitle:get', animeId),
  setSubtitlePref: (animeId: string, language: string) => ipcRenderer.invoke('subtitle:set', animeId, language),

  // --- Episode metadata for Discord RPC (Phase 2) ---
  // Called by animecix.tv website on episode change.
  // animecix.tv already sends 'updateCurrent' IPC; episode:update is the richer channel
  // for Discord RPC carrying title, season, episode, translator, and posterUrl.
  updateEpisode: (data) => ipcRenderer.send('episode:update', data),

  // Play state for Discord RPC — called by animecix.tv when it receives currentTime
  // postMessage from the player iframe (currentTime includes isPlaying every 5s)
  updatePlayState: (isPlaying: boolean) => ipcRenderer.send('episode:playState', isPlaying),

  // Idle state — called when player is closed or navigated away from
  setIdle: () => ipcRenderer.send('episode:idle'),

  // --- Downloads (Phase 3) ---
  downloadVideo: (episodeId: string, url: string, title: string, subUrls: { language: string; url: string }[], metadata?: { animeTitle: string; seasonNumber?: string; episodeNumber?: string; translator?: string; posterUrl?: string; }) =>
    ipcRenderer.invoke('download:start', episodeId, url, title, subUrls, metadata),
  pauseDownload: (id: string) => ipcRenderer.invoke('download:pause', id),
  resumeDownload: (id: string) => ipcRenderer.invoke('download:resume', id),
  cancelDownload: (id: string) => ipcRenderer.invoke('download:cancel', id),
  getDownloadQueue: () => ipcRenderer.invoke('download:getQueue'),
  onDownloadProgress: (cb: (item: DownloadProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, item: DownloadProgress) => cb(item);
    ipcRenderer.on('download:progress', handler);
    return () => ipcRenderer.removeListener('download:progress', handler);
  },
  onDownloadComplete: (cb: (item: { id: string; episodeId: string; title: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, item: { id: string; episodeId: string; title: string }) => cb(item);
    ipcRenderer.on('download:complete', handler);
    return () => ipcRenderer.removeListener('download:complete', handler);
  },

  // --- Cache (Phase 3) ---
  cacheEpisode: (episodeId: string, videoUrl: string, isHls: boolean, subs: { language: string; url: string }[], metadata?: { animeTitle: string; seasonNumber?: string; episodeNumber?: string; translator?: string; posterUrl?: string; }) =>
    ipcRenderer.invoke('cache:episode', episodeId, videoUrl, isHls, subs, metadata),
  isAvailableOffline: (episodeId: string) => ipcRenderer.invoke('offline:isAvailable', episodeId),
  getOfflineUrl: (episodeId: string) => ipcRenderer.invoke('offline:getUrl', episodeId),

  // --- Storage management (Phase 3) ---
  getStorageInfo: () => ipcRenderer.invoke('storage:getInfo'),
  deleteDownload: (episodeId: string) => ipcRenderer.invoke('storage:deleteDownload', episodeId),
  deleteCache: (episodeId: string) => ipcRenderer.invoke('storage:deleteCache', episodeId),
  setCacheMaxBytes: (maxBytes: number) => ipcRenderer.invoke('storage:setCacheMax', maxBytes),

  // --- Library (Phase 7) ---
  getLibraryAnimes: () => ipcRenderer.invoke('library:getAnimes'),
  getLibraryEpisodes: (animeTitle: string) => ipcRenderer.invoke('library:getEpisodes', animeTitle),
  showLibrary: () => ipcRenderer.invoke('library:show'),
  hideLibrary: () => ipcRenderer.invoke('library:hide'),
  playOfflineEpisode: (episodeId: string) => ipcRenderer.invoke('library:playEpisode', episodeId),
  getOfflineVideoData: () => ipcRenderer.invoke('library:getOfflineVideoData'),

  // --- Push notifications (Phase 9) ---
  // animecix.tv reads the token and POSTs it to secure/devices/push-token with
  // its own session cookie; the main process has no auth of its own.
  getPushToken: () => ipcRenderer.invoke(PUSH_CHANNELS.GET_TOKEN),
  onPushToken: (cb: (token: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, token: string) => cb(token);
    ipcRenderer.on(PUSH_CHANNELS.TOKEN, handler);
    return () => ipcRenderer.removeListener(PUSH_CHANNELS.TOKEN, handler);
  },
  onPushMessage: (cb: (payload: PushNotification) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: PushNotification) => cb(payload);
    ipcRenderer.on(PUSH_CHANNELS.MESSAGE, handler);
    return () => ipcRenderer.removeListener(PUSH_CHANNELS.MESSAGE, handler);
  },
};

// --- Updater API (Phase 4) — conforming to UpdaterApi ---
const updaterApi: UpdaterApi = {
  checkForUpdates: () => ipcRenderer.invoke(UPDATER_CHANNELS.CHECK_FOR_UPDATES),
  install: () => ipcRenderer.invoke(UPDATER_CHANNELS.INSTALL),
  dismissBanner: () => ipcRenderer.send(UPDATER_CHANNELS.DISMISS_BANNER),
  openDownloadPage: () => ipcRenderer.send('updater:openDownloadPage'),
  onUpdateReady: (cb: (payload: UpdateReadyPayload) => void) => {
    const listener = (_: Electron.IpcRendererEvent, payload: UpdateReadyPayload) => cb(payload);
    ipcRenderer.on(UPDATER_CHANNELS.UPDATE_READY, listener);
    return () => ipcRenderer.removeListener(UPDATER_CHANNELS.UPDATE_READY, listener);
  },
  onDownloadProgress: (cb: (payload: DownloadProgressPayload) => void) => {
    const listener = (_: Electron.IpcRendererEvent, payload: DownloadProgressPayload) => cb(payload);
    ipcRenderer.on(UPDATER_CHANNELS.DOWNLOAD_PROGRESS, listener);
    return () => ipcRenderer.removeListener(UPDATER_CHANNELS.DOWNLOAD_PROGRESS, listener);
  },
};

contextBridge.exposeInMainWorld('animecix', api);
contextBridge.exposeInMainWorld('animecixAPI', { updater: updaterApi });
