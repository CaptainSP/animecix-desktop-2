/**
 * library.ipc.ts -- IPC handler registration for all library channels.
 *
 * Follows the download.ipc.ts pattern: exported function registers handlers,
 * receives dependencies via parameters.
 *
 * Channels:
 *   library:getAnimes    -- returns all anime groupings from StorageService
 *   library:getEpisodes  -- returns episodes for a specific anime
 *   library:show         -- shows the library BrowserView overlay
 *   library:hide         -- hides the library BrowserView overlay
 *   library:playEpisode  -- hides library, navigates mainWindow to tau-player, sends initVideoData
 */

import { ipcMain, BrowserWindow, net, app } from 'electron';
import { StorageService } from '../storage/StorageService';
import { LibraryManager } from './LibraryManager';
import { pruneMissingDownloads } from '../download/prune-missing';
import type { Video, SkipMeta } from '../player-page/types';
import path from 'node:path';
import fs from 'node:fs';
import log from 'electron-log';

interface OfflineNavigation {
  prevEpisodeId: string | null;
  nextEpisodeId: string | null;
  episodeTitle: string;
  seasonNumber: string;
  episodeNumber: string;
}

interface PendingOfflineData {
  video: Video;
  skipMeta: SkipMeta | null;
  navigation: OfflineNavigation;
}

let pendingOfflineData: PendingOfflineData | null = null;

export function registerLibraryIpc(
  mainWindow: BrowserWindow,
  storage: StorageService,
  libraryManager: LibraryManager,
  downloadsDir: string,
): void {
  ipcMain.handle('library:getAnimes', async () => {
    return storage.getLibraryAnimes();
  });

  ipcMain.handle('library:getEpisodes', async (_event, animeTitle: string) => {
    return storage.getLibraryEpisodes(animeTitle);
  });

  ipcMain.handle('library:show', async () => {
    // Freshen the library first: drop records whose video file was deleted
    // manually, so the overlay never shows episodes that no longer exist.
    pruneMissingDownloads(storage, downloadsDir);
    libraryManager.show();
  });

  ipcMain.handle('library:hide', async () => {
    libraryManager.hide();
  });

  ipcMain.handle('library:getOfflineVideoData', async () => {
    const data = pendingOfflineData;
    pendingOfflineData = null;
    return data;
  });

  ipcMain.handle('library:playEpisode', async (_event, episodeId: string) => {
    libraryManager.deactivate();

    // Step 2: Build offline video and subtitle URLs
    const offlineUrl = `animecix-offline://episode/${episodeId}/video`;

    // Gather subtitle languages from download or cache metadata
    const subtitles: { language: string; url: string; name: string; id: number }[] = [];
    const dl = storage.getDownloadById(episodeId);
    if (dl && dl.status === 'completed' && dl.subUrls) {
      for (const sub of dl.subUrls) {
        subtitles.push({
          language: sub.language,
          url: `animecix-offline://episode/${episodeId}/sub/${sub.language}`,
          name: sub.language,
          id: 0,
        });
      }
    } else {
      const cached = storage.getCacheEntry(episodeId);
      if (cached && cached.subPaths) {
        try {
          const subPaths = JSON.parse(cached.subPaths) as { language: string; path: string }[];
          for (const sub of subPaths) {
            subtitles.push({
              language: sub.language,
              url: `animecix-offline://episode/${episodeId}/sub/${sub.language}`,
              name: sub.language,
              id: 0,
            });
          }
        } catch {
          // Malformed subPaths -- play without subtitles
        }
      }
    }

    // Step 3: Navigate mainWindow to tau-player with offline path.
    // tau-player:// is a local protocol -- works without network.
    // The "/embed/offline" path is a dummy -- the player will receive real
    // data via initVideoData message below (same pattern as Angular's loadOfflineVideo).
    if (!mainWindow.isDestroyed()) {
      // Build navigation info (prev/next episode) and episode metadata
      let prevEpisodeId: string | null = null;
      let nextEpisodeId: string | null = null;
      let episodeTitle = '';
      let seasonNum = '';
      let episodeNum = '';
      const animeTitle = storage.getAnimeTitleForEpisode(episodeId);
      if (animeTitle) {
        episodeTitle = animeTitle;
        const episodes = storage.getLibraryEpisodes(animeTitle);
        const idx = episodes.findIndex((e) => e.episodeId === episodeId);
        if (idx >= 0) {
          seasonNum = episodes[idx].seasonNumber;
          episodeNum = episodes[idx].episodeNumber;
          if (idx > 0) prevEpisodeId = episodes[idx - 1].episodeId;
          if (idx < episodes.length - 1) nextEpisodeId = episodes[idx + 1].episodeId;
        }
      }

      pendingOfflineData = {
        video: {
          _id: episodeId,
          urls: [{ label: '720p', url: offlineUrl, size: 0 }],
          subs: subtitles,
          duration: 0,
          title_id: '',
          season_number: seasonNum,
          episode_number: episodeNum,
          translator: '',
        },
        skipMeta: null,
        navigation: { prevEpisodeId, nextEpisodeId, episodeTitle, seasonNumber: seasonNum, episodeNumber: episodeNum },
      };
      const { getPlayerBaseUrl } = await import('../player/tau-localhost');
      const base = getPlayerBaseUrl();
      await mainWindow.loadURL(base ? `${base}/embed/offline` : 'tau-player://bundle/embed/offline');
      log.info(`[library] Playing offline episode: ${episodeId}`);
    }
  });
}

/**
 * downloadPoster -- Downloads a poster image to userData/posters/{episodeId}.jpg.
 *
 * Per D-08: Poster images are saved locally so the library can display them offline.
 * Per T-07-04: Only HTTPS URLs are allowed to prevent SSRF.
 *
 * @param posterUrl - The HTTPS URL of the poster image
 * @param episodeId - Used as the filename (sanitized by SQLite lookup, not user-controlled path)
 * @returns The local file path if successful, empty string on failure (non-fatal)
 */
export async function downloadPoster(
  posterUrl: string,
  episodeId: string,
): Promise<string> {
  if (!posterUrl || !posterUrl.startsWith('https://')) return '';

  const postersDir = path.join(app.getPath('userData'), 'posters');
  if (!fs.existsSync(postersDir)) {
    fs.mkdirSync(postersDir, { recursive: true });
  }

  const posterPath = path.join(postersDir, `${episodeId}.jpg`);
  if (fs.existsSync(posterPath)) return posterPath; // idempotent

  try {
    const res = await net.fetch(posterUrl);
    if (!res.ok) return '';
    const buf = await res.arrayBuffer();
    fs.writeFileSync(posterPath, Buffer.from(buf));
    return posterPath;
  } catch {
    return ''; // non-fatal -- library shows placeholder if poster missing
  }
}
