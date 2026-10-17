import fs from 'node:fs';
import path from 'node:path';
import type { StorageService } from '../storage/StorageService';
import type { DownloadQueueItem } from './download.types';

/**
 * download:start writes the library row before the queue row (poster fetch and
 * HEAD request sit in between), so a fresh row without a queue entry is normal
 * for a moment; only older ones are orphans.
 */
const ORPHAN_GRACE_SECONDS = 10 * 60;

/**
 * Removes database records for downloads whose video file was manually deleted
 * from the downloads folder (e.g. via File Explorer while the app is running).
 * Without this, the library keeps showing the episode and offline playback
 * fails, which looks broken.
 *
 * Two sources are checked:
 *   - download_queue rows with status 'completed' whose output file is gone;
 *   - episode_metadata rows with source 'download' whose video file is gone
 *     (covers legacy rows that lost their download_queue record);
 *   - episode_metadata rows with source 'download' that have no video file
 *     and no download_queue row (orphans of a failed or cancelled enqueue).
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
  const nowSeconds = Math.floor(Date.now() / 1000);

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
    if (meta.source !== 'download') continue;
    if (!meta.videoPath) {
      // Orphan from an enqueue that failed or a download cancelled before the
      // fix that cleans these up: no file and nothing queued to produce one.
      // These showed as undeletable 0 MB library entries.
      const isPastGrace = nowSeconds - meta.createdAt > ORPHAN_GRACE_SECONDS;
      if (isPastGrace && !storage.getDownloadById(meta.episodeId)) {
        storage.deleteEpisodeMetadata(meta.episodeId);
        removed++;
      }
      continue;
    }
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
