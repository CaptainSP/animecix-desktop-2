import fs from 'node:fs';
import path from 'node:path';
import type { StorageService } from '../storage/StorageService';
import type { DownloadQueueItem } from './download.types';

/**
 * Removes database records for downloads whose video file was manually deleted
 * from the downloads folder (e.g. via File Explorer while the app is running).
 * Without this, the library keeps showing the episode and offline playback
 * fails, which looks broken.
 *
 * Two sources are checked:
 *   - download_queue rows with status 'completed' whose output file is gone;
 *   - episode_metadata rows with source 'download' whose video file is gone
 *     (covers legacy rows that lost their download_queue record).
 *
 * Cache rows (userData/cache) are intentionally untouched — only the user
 * downloads folder is user-managed.
 *
 * Files are only ever pruned when they live inside downloadsDir (path guard).
 * Orphaned subtitle files (.ass) are removed best-effort.
 *
 * @returns the number of pruned episodes
 */
export function pruneMissingDownloads(
  storage: StorageService,
  downloadsDir: string,
): number {
  let removed = 0;

  for (const dl of storage.getAllDownloads()) {
    if (dl.status !== 'completed') continue;
    if (isMissingWithin(downloadsDir, dl.outputPath)) {
      removeSubtitleFiles(dl);
      storage.deleteDownload(dl.id);
      storage.deleteEpisodeMetadata(dl.episodeId);
      removed++;
    }
  }

  for (const meta of storage.getAllEpisodeMetadata()) {
    if (meta.source !== 'download' || !meta.videoPath) continue;
    if (isMissingWithin(downloadsDir, meta.videoPath)) {
      removeMetadataSubtitleFiles(meta.subPaths);
      storage.deleteEpisodeMetadata(meta.episodeId);
      removed++;
    }
  }

  return removed;
}

/** True when the file no longer exists and lives inside downloadsDir. */
function isMissingWithin(downloadsDir: string, filePath: string): boolean {
  const rel = path.relative(downloadsDir, filePath);
  const insideDir = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  return insideDir && !fs.existsSync(filePath);
}

function removeSubtitleFiles(dl: DownloadQueueItem): void {
  const base = dl.outputPath.replace(/\.mp4$/, '');
  for (const sub of dl.subUrls) {
    try {
      fs.unlinkSync(base + '.' + sub.language + '.ass');
    } catch {
      /* ignore — subtitle file may not exist */
    }
  }
}

function removeMetadataSubtitleFiles(subPaths: string): void {
  try {
    const entries = JSON.parse(subPaths) as { language: string; path: string }[];
    for (const entry of entries) {
      try {
        fs.unlinkSync(entry.path);
      } catch {
        /* ignore — subtitle file may not exist */
      }
    }
  } catch {
    /* malformed JSON — nothing to clean */
  }
}
