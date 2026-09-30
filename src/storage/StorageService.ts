// Source: https://github.com/WiseLibs/better-sqlite3
// StorageService — synchronous SQLite wrapper for app settings and window bounds.
// Initialize once in main process before restoring window bounds.

import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import { INIT_SCHEMA } from './schema';
import type { DownloadQueueItem, DownloadStatus } from '../download/download.types';

export class StorageService {
  private db: Database.Database;

  constructor() {
    const dbPath = path.join(app.getPath('userData'), 'animecix.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(INIT_SCHEMA);
    this.runMigrations();
  }

  private runMigrations(): void {
    // Add size_bytes column to episode_metadata for existing installs
    const migrated = this.db
      .prepare("SELECT value FROM settings WHERE key = '_migration_ep_meta_size'")
      .get() as { value: string } | undefined;
    if (migrated && migrated.value === '0') {
      try {
        this.db.exec("ALTER TABLE episode_metadata ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0");
      } catch {
        // Column already exists — ignore
      }
      this.db.prepare("UPDATE settings SET value = '1' WHERE key = '_migration_ep_meta_size'").run();
    }

    // Add video_path + sub_paths columns to episode_metadata (library decoupling)
    const videoPathMigrated = this.db
      .prepare("SELECT value FROM settings WHERE key = '_migration_ep_meta_video_path'")
      .get() as { value: string } | undefined;
    if (videoPathMigrated && videoPathMigrated.value === '0') {
      try {
        this.db.exec("ALTER TABLE episode_metadata ADD COLUMN video_path TEXT NOT NULL DEFAULT ''");
      } catch { /* Column already exists */ }
      try {
        this.db.exec("ALTER TABLE episode_metadata ADD COLUMN sub_paths TEXT NOT NULL DEFAULT '[]'");
      } catch { /* Column already exists */ }
      // Backfill from existing completed downloads
      this.db.exec(`
        UPDATE episode_metadata SET
          video_path = COALESCE((SELECT output_path FROM download_queue WHERE download_queue.id = episode_metadata.episode_id AND download_queue.status = 'completed'), ''),
          sub_paths = COALESCE((SELECT sub_urls FROM download_queue WHERE download_queue.id = episode_metadata.episode_id AND download_queue.status = 'completed'), '[]')
        WHERE video_path = '' AND EXISTS (
          SELECT 1 FROM download_queue WHERE download_queue.id = episode_metadata.episode_id AND download_queue.status = 'completed'
        )
      `);
      this.db.prepare("UPDATE settings SET value = '1' WHERE key = '_migration_ep_meta_video_path'").run();
    }
  }

  getSetting(key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(key, value);
  }

  getWindowBounds(): {
    x?: number;
    y?: number;
    width: number;
    height: number;
    maximized: boolean;
  } {
    const row = this.db
      .prepare('SELECT * FROM window_bounds WHERE id = 1')
      .get() as {
      x: number | null;
      y: number | null;
      width: number;
      height: number;
      maximized: number;
    };
    return {
      x: row.x ?? undefined,
      y: row.y ?? undefined,
      width: row.width,
      height: row.height,
      maximized: !!row.maximized,
    };
  }

  saveWindowBounds(bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
    maximized: boolean;
  }): void {
    this.db
      .prepare(
        'UPDATE window_bounds SET x=?, y=?, width=?, height=?, maximized=? WHERE id=1',
      )
      .run(bounds.x, bounds.y, bounds.width, bounds.height, bounds.maximized ? 1 : 0);
  }

  getSubtitlePref(animeId: string): string {
    const row = this.db
      .prepare('SELECT language FROM subtitle_prefs WHERE anime_id = ?')
      .get(animeId) as { language: string } | undefined;
    return row?.language ?? 'tr';
  }

  setSubtitlePref(animeId: string, language: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO subtitle_prefs (anime_id, language, updated_at) VALUES (?, ?, unixepoch())')
      .run(animeId, language);
  }

  // ── Download queue methods ──────────────────────────────────────────────────

  enqueueDownload(item: {
    id: string;
    episodeId: string;
    title: string;
    url: string;
    subUrls: string;
    outputPath: string;
    totalBytes: number;
    chunks: { chunkIndex: number; byteStart: number; byteEnd: number; tempPath: string }[];
  }): void {
    const insertDownload = this.db.prepare(
      `INSERT INTO download_queue (id, episode_id, title, url, sub_urls, output_path, total_bytes, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', unixepoch(), unixepoch())`,
    );
    const insertChunk = this.db.prepare(
      `INSERT INTO download_chunks (download_id, chunk_index, byte_start, byte_end, bytes_downloaded, temp_path, completed)
       VALUES (?, ?, ?, ?, 0, ?, 0)`,
    );
    const txn = this.db.transaction(() => {
      insertDownload.run(
        item.id,
        item.episodeId,
        item.title,
        item.url,
        item.subUrls,
        item.outputPath,
        item.totalBytes,
      );
      for (const chunk of item.chunks) {
        insertChunk.run(item.id, chunk.chunkIndex, chunk.byteStart, chunk.byteEnd, chunk.tempPath);
      }
    });
    txn();
  }

  updateChunkProgress(
    downloadId: string,
    chunkIndex: number,
    bytesDownloaded: number,
    completed = false,
  ): void {
    this.db
      .prepare(
        `UPDATE download_chunks SET bytes_downloaded = ?, completed = ? WHERE download_id = ? AND chunk_index = ?`,
      )
      .run(bytesDownloaded, completed ? 1 : 0, downloadId, chunkIndex);
  }

  updateDownloadStatus(id: string, status: string): void {
    this.db
      .prepare(`UPDATE download_queue SET status = ?, updated_at = unixepoch() WHERE id = ?`)
      .run(status, id);
  }

  getDownloadById(id: string): DownloadQueueItem | null {
    const row = this.db.prepare(`SELECT * FROM download_queue WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    const chunks = this.db
      .prepare(`SELECT * FROM download_chunks WHERE download_id = ? ORDER BY chunk_index`)
      .all(id) as Record<string, unknown>[];
    return this._mapDownloadRow(row, chunks);
  }

  getIncompleteDownloads(): DownloadQueueItem[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM download_queue WHERE status IN ('queued','downloading','paused') ORDER BY created_at ASC`,
      )
      .all() as Record<string, unknown>[];
    return rows.map((row) => {
      const chunks = this.db
        .prepare(`SELECT * FROM download_chunks WHERE download_id = ? ORDER BY chunk_index`)
        .all(row['id'] as string) as Record<string, unknown>[];
      return this._mapDownloadRow(row, chunks);
    });
  }

  getAllDownloads(): DownloadQueueItem[] {
    const rows = this.db
      .prepare(`SELECT * FROM download_queue ORDER BY created_at DESC`)
      .all() as Record<string, unknown>[];
    return rows.map((row) => {
      const chunks = this.db
        .prepare(`SELECT * FROM download_chunks WHERE download_id = ? ORDER BY chunk_index`)
        .all(row['id'] as string) as Record<string, unknown>[];
      return this._mapDownloadRow(row, chunks);
    });
  }

  deleteDownload(id: string): void {
    this.db.prepare(`DELETE FROM download_queue WHERE id = ?`).run(id);
  }

  private _mapDownloadRow(
    row: Record<string, unknown>,
    chunks: Record<string, unknown>[],
  ): DownloadQueueItem {
    return {
      id: row['id'] as string,
      episodeId: row['episode_id'] as string,
      title: row['title'] as string,
      url: row['url'] as string,
      subUrls: JSON.parse(row['sub_urls'] as string) as { language: string; url: string }[],
      outputPath: row['output_path'] as string,
      totalBytes: row['total_bytes'] as number,
      status: row['status'] as DownloadStatus,
      createdAt: row['created_at'] as number,
      updatedAt: row['updated_at'] as number,
      chunks: chunks.map((c) => ({
        downloadId: c['download_id'] as string,
        chunkIndex: c['chunk_index'] as number,
        byteStart: c['byte_start'] as number,
        byteEnd: c['byte_end'] as number,
        bytesDownloaded: c['bytes_downloaded'] as number,
        tempPath: c['temp_path'] as string,
        completed: !!(c['completed'] as number),
      })),
    };
  }

  // ── Cache index methods ─────────────────────────────────────────────────────

  addCacheEntry(entry: {
    episodeId: string;
    mp4Path: string;
    subPaths: string;
    sizeBytes: number;
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO cache_index (episode_id, mp4_path, sub_paths, size_bytes, last_accessed, created_at)
         VALUES (?, ?, ?, ?, unixepoch(), unixepoch())`,
      )
      .run(entry.episodeId, entry.mp4Path, entry.subPaths, entry.sizeBytes);
  }

  getCacheEntry(episodeId: string): {
    episodeId: string;
    mp4Path: string;
    subPaths: string;
    sizeBytes: number;
    lastAccessed: number;
    createdAt: number;
  } | null {
    const row = this.db
      .prepare(`SELECT * FROM cache_index WHERE episode_id = ?`)
      .get(episodeId) as Record<string, unknown> | undefined;
    if (!row) return null;
    this.db
      .prepare(`UPDATE cache_index SET last_accessed = unixepoch() WHERE episode_id = ?`)
      .run(episodeId);
    return {
      episodeId: row['episode_id'] as string,
      mp4Path: row['mp4_path'] as string,
      subPaths: row['sub_paths'] as string,
      sizeBytes: row['size_bytes'] as number,
      lastAccessed: row['last_accessed'] as number,
      createdAt: row['created_at'] as number,
    };
  }

  deleteCacheEntry(episodeId: string): void {
    this.db.prepare(`DELETE FROM cache_index WHERE episode_id = ?`).run(episodeId);
  }

  deleteEpisodeMetadata(episodeId: string): void {
    this.db.prepare(`DELETE FROM episode_metadata WHERE episode_id = ?`).run(episodeId);
  }

  updateEpisodeMetadataSize(episodeId: string, sizeBytes: number): void {
    this.db.prepare(`UPDATE episode_metadata SET size_bytes = ? WHERE episode_id = ?`).run(sizeBytes, episodeId);
  }

  updateEpisodeMetadataVideoPath(episodeId: string, videoPath: string, subPaths: string): void {
    this.db
      .prepare(`UPDATE episode_metadata SET video_path = ?, sub_paths = ? WHERE episode_id = ?`)
      .run(videoPath, subPaths, episodeId);
  }

  getEpisodeVideoPaths(episodeId: string): { videoPath: string; subPaths: string } | null {
    const row = this.db
      .prepare('SELECT video_path, sub_paths FROM episode_metadata WHERE episode_id = ?')
      .get(episodeId) as { video_path: string; sub_paths: string } | undefined;
    if (!row || !row.video_path) return null;
    return { videoPath: row.video_path, subPaths: row.sub_paths };
  }

  getCacheStats(): { totalBytes: number; episodes: { episodeId: string; sizeBytes: number }[] } {
    const totalRow = this.db
      .prepare(`SELECT COALESCE(SUM(size_bytes), 0) as total FROM cache_index`)
      .get() as { total: number };
    const episodes = this.db
      .prepare(`SELECT episode_id, size_bytes FROM cache_index ORDER BY episode_id`)
      .all() as { episode_id: string; size_bytes: number }[];
    return {
      totalBytes: totalRow.total,
      episodes: episodes.map((e) => ({ episodeId: e.episode_id, sizeBytes: e.size_bytes })),
    };
  }

  evictOldestCache(maxBytes: number): { episodeId: string; mp4Path: string; subPaths: string }[] {
    const evicted: { episodeId: string; mp4Path: string; subPaths: string }[] = [];
    const totalRow = this.db
      .prepare(`SELECT COALESCE(SUM(size_bytes), 0) as total FROM cache_index`)
      .get() as { total: number };
    let total = totalRow.total;
    while (total > maxBytes) {
      const oldest = this.db
        .prepare(`SELECT * FROM cache_index ORDER BY last_accessed ASC LIMIT 1`)
        .get() as Record<string, unknown> | undefined;
      if (!oldest) break;
      evicted.push({
        episodeId: oldest['episode_id'] as string,
        mp4Path: oldest['mp4_path'] as string,
        subPaths: oldest['sub_paths'] as string,
      });
      this.db
        .prepare(`DELETE FROM cache_index WHERE episode_id = ?`)
        .run(oldest['episode_id'] as string);
      total -= oldest['size_bytes'] as number;
    }
    return evicted;
  }

  // ── Episode metadata methods (Phase 7 — Library) ────────────────────────────

  upsertEpisodeMetadata(meta: {
    episodeId: string;
    animeTitle: string;
    seasonNumber: string;
    episodeNumber: string;
    translator: string;
    posterUrl: string;
    posterPath: string;
    source: 'download' | 'cache';
    sizeBytes?: number;
    videoPath?: string;
    subPaths?: string;
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO episode_metadata
         (episode_id, anime_title, season_number, episode_number, translator, poster_url, poster_path, source, size_bytes, video_path, sub_paths, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`
      )
      .run(
        meta.episodeId, meta.animeTitle, meta.seasonNumber,
        meta.episodeNumber, meta.translator, meta.posterUrl,
        meta.posterPath, meta.source, meta.sizeBytes ?? 0,
        meta.videoPath ?? '', meta.subPaths ?? '[]'
      );
  }

  getAnimeTitleForEpisode(episodeId: string): string | null {
    const row = this.db
      .prepare('SELECT anime_title FROM episode_metadata WHERE episode_id = ?')
      .get(episodeId) as { anime_title: string } | undefined;
    return row?.anime_title ?? null;
  }

  getAllEpisodeMetadata(): {
    episodeId: string;
    source: 'download' | 'cache';
    videoPath: string;
    subPaths: string;
  }[] {
    const rows = this.db
      .prepare(`SELECT episode_id, source, video_path, sub_paths FROM episode_metadata`)
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      episodeId: r['episode_id'] as string,
      source: r['source'] as 'download' | 'cache',
      videoPath: (r['video_path'] as string) ?? '',
      subPaths: (r['sub_paths'] as string) ?? '[]',
    }));
  }

  getLibraryAnimes(): { animeTitle: string; posterPath: string; episodeCount: number }[] {
    const rows = this.db
      .prepare(
        `SELECT anime_title, MAX(poster_path) as poster_path, COUNT(*) as episode_count
         FROM episode_metadata
         GROUP BY anime_title
         ORDER BY anime_title ASC`
      )
      .all() as { anime_title: string; poster_path: string; episode_count: number }[];
    return rows.map((r) => ({
      animeTitle: r.anime_title,
      posterPath: r.poster_path,
      episodeCount: r.episode_count,
    }));
  }

  getLibraryEpisodes(animeTitle: string): {
    episodeId: string;
    animeTitle: string;
    seasonNumber: string;
    episodeNumber: string;
    translator: string;
    source: 'download' | 'cache';
    sizeBytes: number;
    createdAt: number;
    offlineUrl: string;
  }[] {
    const rows = this.db
      .prepare(
        `SELECT episode_id, anime_title, season_number, episode_number,
                translator, source, size_bytes, created_at
         FROM episode_metadata
         WHERE anime_title = ?
         ORDER BY season_number ASC, CAST(episode_number AS INTEGER) ASC`
      )
      .all(animeTitle) as Record<string, unknown>[];
    return rows.map((r) => ({
      episodeId: r['episode_id'] as string,
      animeTitle: r['anime_title'] as string,
      seasonNumber: r['season_number'] as string,
      episodeNumber: r['episode_number'] as string,
      translator: r['translator'] as string,
      source: r['source'] as 'download' | 'cache',
      sizeBytes: r['size_bytes'] as number,
      createdAt: r['created_at'] as number,
      offlineUrl: `animecix-offline://episode/${r['episode_id']}/video`,
    }));
  }

  close(): void {
    this.db.close();
  }
}
