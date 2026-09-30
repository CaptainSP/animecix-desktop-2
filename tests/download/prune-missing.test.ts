import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruneMissingDownloads } from '../../src/download/prune-missing';
import type { DownloadQueueItem } from '../../src/download/download.types';

interface MetaRow {
  episodeId: string;
  source: 'download' | 'cache';
  videoPath: string;
  subPaths: string;
}

function makeDownloadItem(overrides: Partial<DownloadQueueItem> & { id: string; episodeId: string; outputPath: string }): DownloadQueueItem {
  return {
    id: overrides.id,
    episodeId: overrides.episodeId,
    outputPath: overrides.outputPath,
    title: 'Test Episode',
    url: 'https://example.com/video.mp4',
    subUrls: overrides.subUrls ?? [],
    totalBytes: 1000,
    status: overrides.status ?? 'completed',
    createdAt: 1,
    updatedAt: 1,
    chunks: [],
  };
}

function makeStorage(downloads: DownloadQueueItem[], metas: MetaRow[]) {
  const deleted: string[] = [];
  return {
    getAllDownloads: () => [...downloads],
    getAllEpisodeMetadata: () => [...metas],
    deleteDownload: (id: string) => {
      deleted.push(`dl:${id}`);
      const idx = downloads.findIndex((d) => d.id === id);
      if (idx !== -1) downloads.splice(idx, 1);
    },
    deleteEpisodeMetadata: (id: string) => {
      deleted.push(`meta:${id}`);
      const idx = metas.findIndex((m) => m.episodeId === id);
      if (idx !== -1) metas.splice(idx, 1);
    },
    deleted,
  };
}

describe('pruneMissingDownloads', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('removes completed downloads whose file was deleted', () => {
    const downloads: DownloadQueueItem[] = [
      makeDownloadItem({ id: 'dl-1', episodeId: 'ep-1', outputPath: path.join(dir, 'gone.mp4') }),
    ];
    const metas: MetaRow[] = [
      { episodeId: 'ep-1', source: 'download', videoPath: path.join(dir, 'gone.mp4'), subPaths: '[]' },
    ];
    const storage = makeStorage(downloads, metas);

    const removed = pruneMissingDownloads(storage, dir);

    expect(removed).toBe(1);
    expect(storage.deleted).toEqual(['dl:dl-1', 'meta:ep-1']);
  });

  it('keeps completed downloads whose file still exists', () => {
    const file = path.join(dir, 'exists.mp4');
    fs.writeFileSync(file, 'x');
    const downloads: DownloadQueueItem[] = [
      makeDownloadItem({ id: 'dl-2', episodeId: 'ep-2', outputPath: file }),
    ];
    const storage = makeStorage(downloads, []);

    const removed = pruneMissingDownloads(storage, dir);

    expect(removed).toBe(0);
    expect(storage.deleted).toEqual([]);
  });

  it('keeps incomplete downloads with a missing file', () => {
    const downloads: DownloadQueueItem[] = [
      makeDownloadItem({ id: 'dl-3', episodeId: 'ep-3', outputPath: path.join(dir, 'partial.mp4'), status: 'downloading' }),
      makeDownloadItem({ id: 'dl-4', episodeId: 'ep-4', outputPath: path.join(dir, 'queued.mp4'), status: 'queued' }),
    ];
    const storage = makeStorage(downloads, []);

    const removed = pruneMissingDownloads(storage, dir);

    expect(removed).toBe(0);
    expect(storage.deleted).toEqual([]);
  });

  it('removes download metadata whose video file was deleted without a queue record', () => {
    const metas: MetaRow[] = [
      { episodeId: 'ep-5', source: 'download', videoPath: path.join(dir, 'legacy.mp4'), subPaths: '[]' },
    ];
    const storage = makeStorage([], metas);

    const removed = pruneMissingDownloads(storage, dir);

    expect(removed).toBe(1);
    expect(storage.deleted).toEqual(['meta:ep-5']);
  });

  it('never prunes cache-source metadata', () => {
    const metas: MetaRow[] = [
      { episodeId: 'ep-6', source: 'cache', videoPath: path.join(dir, 'cached.mp4'), subPaths: '[]' },
    ];
    const storage = makeStorage([], metas);

    const removed = pruneMissingDownloads(storage, dir);

    expect(removed).toBe(0);
    expect(storage.deleted).toEqual([]);
  });

  it('never prunes files outside the downloads directory', () => {
    const outside = path.join(os.tmpdir(), 'unrelated-' + Date.now() + '.mp4');
    try {
      fs.writeFileSync(outside, 'x');
      fs.unlinkSync(outside); // deleted, but outside downloadsDir
    } catch {
      /* cleanup */
    }
    const downloads: DownloadQueueItem[] = [
      makeDownloadItem({ id: 'dl-7', episodeId: 'ep-7', outputPath: outside }),
    ];
    const storage = makeStorage(downloads, []);

    const removed = pruneMissingDownloads(storage, dir);

    expect(removed).toBe(0);
    expect(storage.deleted).toEqual([]);
  });

  it('removes orphaned subtitle files together with the video record', () => {
    const video = path.join(dir, 'episode.mp4');
    const sub = path.join(dir, 'episode.TR.ass');
    fs.writeFileSync(sub, 'dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,merhaba');
    const downloads: DownloadQueueItem[] = [
      makeDownloadItem({
        id: 'dl-8',
        episodeId: 'ep-8',
        outputPath: video,
        subUrls: [{ language: 'TR', url: 'https://example.com/tr.ass' }],
      }),
    ];
    const storage = makeStorage(downloads, []);

    const removed = pruneMissingDownloads(storage, dir);

    expect(removed).toBe(1);
    expect(fs.existsSync(sub)).toBe(false);
  });

  it('returns the number of pruned episodes', () => {
    const downloads: DownloadQueueItem[] = [
      makeDownloadItem({ id: 'dl-9', episodeId: 'ep-9', outputPath: path.join(dir, 'a.mp4') }),
      makeDownloadItem({ id: 'dl-10', episodeId: 'ep-10', outputPath: path.join(dir, 'b.mp4') }),
    ];
    const storage = makeStorage(downloads, []);

    expect(pruneMissingDownloads(storage, dir)).toBe(2);
  });
});
