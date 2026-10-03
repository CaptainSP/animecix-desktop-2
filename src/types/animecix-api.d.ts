// Source: https://www.electronjs.org/docs/latest/tutorial/context-isolation
// AnimecixAPI interface — the typed contract exposed via contextBridge on window.animecix
// The preload script (Plan 02) implements this. The animecix.tv website consumes it.

// Download progress for a single queued/active/completed download item (Phase 3)
export interface DownloadProgress {
  id: string;
  episodeId: string;
  title: string;
  status: 'queued' | 'downloading' | 'paused' | 'completed' | 'failed';
  progressPercent: number;
  speedBps: number;
  totalBytes: number;
  downloadedBytes: number;
}

// Storage usage summary returned by getStorageInfo (Phase 3)
export interface StorageInfo {
  downloadsBytes: number;
  cacheBytes: number;
  cacheMaxBytes: number;
  episodes: { episodeId: string; title: string; sizeBytes: number; isDownload: boolean }[];
}

// Video data returned by tau-video.xyz API (matches player-page/types.ts Video)
export interface VideoData {
  _id: string;
  durationDifference?: number;
  duration: number;
  title_id: string;
  season_number: string;
  episode_number: string;
  ratio?: number;
  hls?: string;
  urls: { label: string; url: string; size: number }[];
  subs: { id: number; language: string; url: string; name: string }[];
  translator: string;
}

// Skip markers returned by tau-video.xyz API (matches player-page/types.ts SkipMeta)
export interface SkipMetaData {
  [key: string]: { from: number; to: number };
}

// Library types (Phase 7)
export interface LibraryAnime {
  animeTitle: string;
  posterPath: string;
  episodeCount: number;
}

export interface LibraryEpisode {
  episodeId: string;
  animeTitle: string;
  seasonNumber: string;
  episodeNumber: string;
  translator: string;
  source: 'download' | 'cache';
  sizeBytes: number;
  createdAt: number;
  offlineUrl: string;
}

// Push notification payload after normalisation (Phase 9).
// Mirrors src/notifications/push.types.ts — duplicated here because the
// website consumes this .d.ts as the whole desktop contract.
export interface PushNotification {
  title: string;
  body: string;
  url: string | null;
  image: string | null;
}

export interface AnimecixAPI {
  // Window controls — invoke IPC calls to main process
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  setFullscreen: (fullscreen: boolean) => Promise<void>;

  // Event subscription — returns unsubscribe function
  onFullscreenChange: (cb: (isFullscreen: boolean) => void) => () => void;

  // Platform info — synchronous values set at preload time
  platform: NodeJS.Platform;
  version: string | undefined;
  isOnline: () => boolean;

  // Open URL in system default browser (used by Angular for Google OAuth login)
  openLink: (url: string) => Promise<void>;

  // Holds the display awake while an episode plays (OS power save blocker).
  // Called by animecix.tv on the player's play/pause postMessages, and by the
  // player page directly when it is the top-level document (offline playback).
  setKeepAwake: (enabled: boolean) => Promise<void>;

  // --- Video data pre-fetch (fast path for tau-video sources) ---
  // Fetches video data + skip markers from tau-video.xyz API via main process (no CORS).
  // Returns { video, meta } or null on failure.
  fetchVideoData: (id: string, vid?: string) => Promise<{ video: VideoData; meta: SkipMetaData | null } | null>;

  // Converts tau-video.xyz embed URL to local tau-player:// URL.
  // Returns null if the URL is not a tau-video embed.
  getPlayerUrl: (embedUrl: string) => string | null;

  // --- Subtitle preferences (Phase 2) ---
  // Called by animecix.tv website (NOT by the player iframe).
  // animecix.tv bridges between player postMessage (captionsChanged) and SQLite IPC.
  getSubtitlePref: (animeId: string) => Promise<string>;
  setSubtitlePref: (animeId: string, language: string) => Promise<void>;

  // --- Episode metadata for Discord RPC (Phase 2) ---
  // Called by animecix.tv website on episode change and play state updates.
  // animecix.tv is the bridge: it receives postMessages from the player iframe and
  // forwards episode metadata/play state to main process via these channels.
  updateEpisode: (data: {
    title: string;
    titleId?: string | number;
    seasonNumber?: string;
    episodeNumber?: string;
    translator?: string;
    posterUrl?: string;
  }) => void;
  updatePlayState: (isPlaying: boolean) => void;
  setIdle: () => void;

  // --- Downloads (Phase 3) ---
  downloadVideo: (
    episodeId: string, url: string, title: string,
    subUrls: { language: string; url: string }[],
    metadata?: { animeTitle: string; seasonNumber?: string; episodeNumber?: string; translator?: string; posterUrl?: string; }
  ) => Promise<void>;
  pauseDownload: (id: string) => Promise<void>;
  resumeDownload: (id: string) => Promise<void>;
  cancelDownload: (id: string) => Promise<void>;
  getDownloadQueue: () => Promise<DownloadProgress[]>;
  onDownloadProgress: (cb: (item: DownloadProgress) => void) => () => void;
  onDownloadComplete: (cb: (item: { id: string; episodeId: string; title: string }) => void) => () => void;

  // --- Cache (Phase 3) ---
  cacheEpisode: (
    episodeId: string, videoUrl: string, isHls: boolean,
    subs: { language: string; url: string }[],
    metadata?: { animeTitle: string; seasonNumber?: string; episodeNumber?: string; translator?: string; posterUrl?: string; }
  ) => Promise<void>;
  isAvailableOffline: (episodeId: string) => Promise<boolean>;
  getOfflineUrl: (episodeId: string) => Promise<string | null>;

  // --- Storage management (Phase 3) ---
  getStorageInfo: () => Promise<StorageInfo>;
  deleteDownload: (episodeId: string) => Promise<void>;
  deleteCache: (episodeId: string) => Promise<void>;
  setCacheMaxBytes: (maxBytes: number) => Promise<void>;

  // --- Library (Phase 7) ---
  getLibraryAnimes: () => Promise<LibraryAnime[]>;
  getLibraryEpisodes: (animeTitle: string) => Promise<LibraryEpisode[]>;
  showLibrary: () => Promise<void>;
  hideLibrary: () => Promise<void>;
  playOfflineEpisode: (episodeId: string) => Promise<void>;

  // --- Push notifications (Phase 9) ---
  // The website registers the token with animecix-js
  // (POST secure/devices/push-token) using its own session — the main process
  // has no auth. Returns null while registration is still in flight or when
  // push is disabled (no FCM config in this build).
  getPushToken: () => Promise<string | null>;
  // Fires when a token first arrives or FCM rotates it. Returns unsubscribe.
  onPushToken: (cb: (token: string) => void) => () => void;
  // Fires for every push. The OS notification is shown by the main process;
  // this is for updating the in-app bell without a refetch.
  onPushMessage: (cb: (payload: PushNotification) => void) => () => void;
}

declare global {
  interface Window {
    animecix?: AnimecixAPI;
  }
}
