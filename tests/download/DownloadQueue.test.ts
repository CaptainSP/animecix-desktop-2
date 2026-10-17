import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mock electron before importing DownloadQueue
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => `/tmp/mock-${name}`,
  },
}));

import { DownloadQueue } from '../../src/download/DownloadQueue';
import type { DownloadQueueItem, DownloadStatus } from '../../src/download/download.types';

function createMockStorage() {
  const downloads: Map<string, any> = new Map();
  const chunks: Map<string, any[]> = new Map();

  return {
    downloads,
    chunks,

    enqueueDownload(item: any): void {
      downloads.set(item.id, {
        id: item.id,
        episode_id: item.episodeId,
        title: item.title,
        url: item.url,
        sub_urls: item.subUrls,
        output_path: item.outputPath,
        total_bytes: item.totalBytes,
        status: 'queued',
        created_at: Date.now(),
        updated_at: Date.now(),
      });
      chunks.set(
        item.id,
        item.chunks.map((c: any) => ({
          download_id: item.id,
          chunk_index: c.chunkIndex,
          byte_start: c.byteStart,
          byte_end: c.byteEnd,
          bytes_downloaded: 0,
          temp_path: c.tempPath,
          completed: 0,
        })),
      );
    },

    updateChunkProgress(downloadId: string, chunkIndex: number, bytesDownloaded: number, completed = false): void {
      const chunkList = chunks.get(downloadId);
      if (chunkList) {
        const chunk = chunkList.find((c) => c.chunk_index === chunkIndex);
        if (chunk) {
          chunk.bytes_downloaded = bytesDownloaded;
          chunk.completed = completed ? 1 : 0;
        }
      }
    },

    updateDownloadStatus(id: string, status: string): void {
      const dl = downloads.get(id);
      if (dl) {
        dl.status = status;
        dl.updated_at = Date.now();
      }
    },

    getDownloadById(id: string): DownloadQueueItem | null {
      const dl = downloads.get(id);
      if (!dl) return null;
      return mapRow(dl, chunks.get(id) ?? []);
    },

    getIncompleteDownloads(): DownloadQueueItem[] {
      const result: DownloadQueueItem[] = [];
      for (const [id, dl] of downloads) {
        if (['queued', 'downloading', 'paused'].includes(dl.status)) {
          result.push(mapRow(dl, chunks.get(id) ?? []));
        }
      }
      result.sort((a, b) => a.createdAt - b.createdAt);
      return result;
    },

    getAllDownloads(): DownloadQueueItem[] {
      const result: DownloadQueueItem[] = [];
      for (const [id, dl] of downloads) {
        result.push(mapRow(dl, chunks.get(id) ?? []));
      }
      result.sort((a, b) => b.createdAt - a.createdAt);
      return result;
    },

    deleteDownload(id: string): void {
      downloads.delete(id);
      chunks.delete(id);
    },

    deletedMetadata: [] as string[],

    deleteEpisodeMetadata(episodeId: string): void {
      this.deletedMetadata.push(episodeId);
    },
  };
}

function mapRow(dl: any, chunkList: any[]): DownloadQueueItem {
  return {
    id: dl.id,
    episodeId: dl.episode_id,
    title: dl.title,
    url: dl.url,
    subUrls: JSON.parse(dl.sub_urls),
    outputPath: dl.output_path,
    totalBytes: dl.total_bytes,
    status: dl.status as DownloadStatus,
    createdAt: dl.created_at,
    updatedAt: dl.updated_at,
    chunks: chunkList.map((c) => ({
      downloadId: c.download_id,
      chunkIndex: c.chunk_index,
      byteStart: c.byte_start,
      byteEnd: c.byte_end,
      bytesDownloaded: c.bytes_downloaded,
      tempPath: c.temp_path,
      completed: !!c.completed,
    })),
  };
}

describe('DownloadQueue', () => {
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    storage = createMockStorage();
  });

  it('crash recovery resets downloading items to queued then re-processes', () => {
    // Pre-populate storage with a "downloading" item (simulating a crash)
    storage.enqueueDownload({
      id: 'crash-test',
      episodeId: 'ep-1',
      title: 'Test Episode',
      url: 'https://example.com/video.mp4',
      subUrls: '[]',
      outputPath: '/tmp/test.mp4',
      totalBytes: 1000,
      chunks: [{ chunkIndex: 0, byteStart: 0, byteEnd: 999, tempPath: '/tmp/test.part0' }],
    });
    storage.updateDownloadStatus('crash-test', 'downloading');

    // Track status transitions
    const statusHistory: string[] = [];
    const origUpdate = storage.updateDownloadStatus.bind(storage);
    storage.updateDownloadStatus = (id: string, status: string) => {
      statusHistory.push(status);
      origUpdate(id, status);
    };

    // Creating queue should reset 'downloading' to 'queued', then processNext picks it up
    const _queue = new DownloadQueue(storage as any, '/tmp/nonexistent-dl-dir');

    // First status change should be 'queued' (crash recovery), then 'downloading' (processNext)
    expect(statusHistory[0]).toBe('queued');
    expect(statusHistory[1]).toBe('downloading');
  });

  it('pause marks queued item as paused', () => {
    storage.enqueueDownload({
      id: 'pause-test',
      episodeId: 'ep-2',
      title: 'Pause Episode',
      url: 'https://example.com/video2.mp4',
      subUrls: '[]',
      outputPath: '/tmp/test2.mp4',
      totalBytes: 1000,
      chunks: [{ chunkIndex: 0, byteStart: 0, byteEnd: 999, tempPath: '/tmp/test2.part0' }],
    });

    const queue = new DownloadQueue(storage as any, '/tmp/nonexistent-dl-dir');
    queue.pause('pause-test');

    const dl = storage.downloads.get('pause-test');
    expect(dl.status).toBe('paused');
  });

  it('resume sets paused item to queued then processNext picks it up', () => {
    storage.enqueueDownload({
      id: 'resume-test',
      episodeId: 'ep-3',
      title: 'Resume Episode',
      url: 'https://example.com/video3.mp4',
      subUrls: '[]',
      outputPath: '/tmp/test3.mp4',
      totalBytes: 1000,
      chunks: [{ chunkIndex: 0, byteStart: 0, byteEnd: 999, tempPath: '/tmp/test3.part0' }],
    });
    storage.updateDownloadStatus('resume-test', 'paused');

    // Track status transitions
    const statusHistory: string[] = [];
    const origUpdate = storage.updateDownloadStatus.bind(storage);
    storage.updateDownloadStatus = (id: string, status: string) => {
      statusHistory.push(status);
      origUpdate(id, status);
    };

    const queue = new DownloadQueue(storage as any, '/tmp/nonexistent-dl-dir');
    queue.resume('resume-test');

    // resume sets to 'queued', then processNext sets to 'downloading'
    expect(statusHistory).toContain('queued');
  });

  it('cancel removes download from storage', () => {
    storage.enqueueDownload({
      id: 'cancel-test',
      episodeId: 'ep-4',
      title: 'Cancel Episode',
      url: 'https://example.com/video4.mp4',
      subUrls: '[]',
      outputPath: '/tmp/test4.mp4',
      totalBytes: 1000,
      chunks: [{ chunkIndex: 0, byteStart: 0, byteEnd: 999, tempPath: '/tmp/test4.part0' }],
    });

    const queue = new DownloadQueue(storage as any, '/tmp/nonexistent-dl-dir');
    queue.cancel('cancel-test');

    expect(storage.downloads.has('cancel-test')).toBe(false);
  });

  it('getQueue returns progress for all downloads', () => {
    storage.enqueueDownload({
      id: 'q1',
      episodeId: 'ep-5',
      title: 'Episode 5',
      url: 'https://example.com/v5.mp4',
      subUrls: '[]',
      outputPath: '/tmp/t5.mp4',
      totalBytes: 2000,
      chunks: [
        { chunkIndex: 0, byteStart: 0, byteEnd: 999, tempPath: '/tmp/t5.part0' },
        { chunkIndex: 1, byteStart: 1000, byteEnd: 1999, tempPath: '/tmp/t5.part1' },
      ],
    });
    storage.enqueueDownload({
      id: 'q2',
      episodeId: 'ep-6',
      title: 'Episode 6',
      url: 'https://example.com/v6.mp4',
      subUrls: '[]',
      outputPath: '/tmp/t6.mp4',
      totalBytes: 1000,
      chunks: [{ chunkIndex: 0, byteStart: 0, byteEnd: 999, tempPath: '/tmp/t6.part0' }],
    });

    const queue = new DownloadQueue(storage as any, '/tmp/nonexistent-dl-dir');
    const progress = queue.getQueue();

    expect(progress).toHaveLength(2);
    expect(progress[0].id).toBeDefined();
    expect(progress[0]).toHaveProperty('progressPercent');
    expect(progress[0]).toHaveProperty('totalBytes');
  });

  describe('add() for an episode that already has a row', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlq-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function seed(id: string, status: string, outputPath = path.join(tmpDir, `${id}.mp4`)) {
      storage.enqueueDownload({
        id,
        episodeId: id,
        title: id,
        url: 'https://old.example.com/expired.mp4',
        subUrls: '[]',
        outputPath,
        totalBytes: 1000,
        chunks: [{ chunkIndex: 0, byteStart: 0, byteEnd: 999, tempPath: outputPath + '.part0' }],
      });
      storage.updateDownloadStatus(id, status);
    }

    function makeQueue(): DownloadQueue {
      const queue = new DownloadQueue(storage as any, tmpDir);
      (queue as any).getContentLength = async () => 2000;
      // Keep the test offline: nothing should actually start downloading.
      (queue as any).processNext = () => {};
      return queue;
    }

    it.each(['paused', 'failed'])('re-enqueues a %s download with the fresh URL', async (status) => {
      seed('ep-a', status);
      fs.writeFileSync(path.join(tmpDir, 'ep-a.mp4.part0'), 'stale');
      const queue = makeQueue();

      await expect(
        queue.add('ep-a', 'https://new.example.com/fresh.mp4', 'ep-a', []),
      ).resolves.toBe('ep-a');

      const dl = storage.getDownloadById('ep-a');
      expect(dl?.status).toBe('queued');
      expect(dl?.url).toBe('https://new.example.com/fresh.mp4');
      expect(dl?.totalBytes).toBe(2000);
      expect(fs.existsSync(path.join(tmpDir, 'ep-a.mp4.part0'))).toBe(false);
    });

    it('leaves a completed download whose file exists untouched', async () => {
      seed('ep-b', 'completed');
      fs.writeFileSync(path.join(tmpDir, 'ep-b.mp4'), 'video');
      const queue = makeQueue();

      await queue.add('ep-b', 'https://new.example.com/fresh.mp4', 'ep-b', []);

      const dl = storage.getDownloadById('ep-b');
      expect(dl?.status).toBe('completed');
      expect(dl?.url).toBe('https://old.example.com/expired.mp4');
    });

    it('re-downloads a completed episode whose file was deleted', async () => {
      seed('ep-c', 'completed');
      const queue = makeQueue();

      await queue.add('ep-c', 'https://new.example.com/fresh.mp4', 'ep-c', []);

      expect(storage.getDownloadById('ep-c')?.status).toBe('queued');
    });

    it('rejects an unknown file size instead of creating an empty download', async () => {
      const queue = makeQueue();
      (queue as any).getContentLength = async () => 0;

      await expect(
        queue.add('ep-d', 'https://new.example.com/fresh.mp4', 'ep-d', []),
      ).rejects.toThrow('Could not determine file size');
      expect(storage.getDownloadById('ep-d')).toBeNull();
    });
  });

  it('cancel removes the library entry of an unfinished download', () => {
    storage.enqueueDownload({
      id: 'cancel-meta',
      episodeId: 'cancel-meta',
      title: 'x',
      url: 'https://example.com/x.mp4',
      subUrls: '[]',
      outputPath: '/tmp/cancel-meta.mp4',
      totalBytes: 1000,
      chunks: [],
    });
    storage.updateDownloadStatus('cancel-meta', 'paused');

    const queue = new DownloadQueue(storage as any, '/tmp/nonexistent-dl-dir');
    queue.cancel('cancel-meta');

    expect(storage.deletedMetadata).toContain('cancel-meta');
  });

  function seedQueued(ids: string[]) {
    ids.forEach((id, i) => {
      storage.enqueueDownload({
        id,
        episodeId: id,
        title: id,
        url: 'https://example.com/' + id + '.mp4',
        subUrls: '[]',
        outputPath: '/tmp/' + id + '.mp4',
        totalBytes: 1000,
        chunks: [{ chunkIndex: 0, byteStart: 0, byteEnd: 999, tempPath: '/tmp/' + id + '.part0' }],
      });
      storage.downloads.get(id).created_at = i;
    });
  }

  it('pausing the active download starts the next queued one', () => {
    seedQueued(['first', 'second']);

    const queue = new DownloadQueue(storage as any, '/tmp/nonexistent-dl-dir');
    expect(storage.downloads.get('first').status).toBe('downloading');

    queue.pause('first');

    expect(storage.downloads.get('first').status).toBe('paused');
    expect(storage.downloads.get('second').status).toBe('downloading');
    queue.pauseAll();
  });

  it('pauseAll pauses everything without starting queued items', () => {
    seedQueued(['p1', 'p2', 'p3']);
    const started: string[] = [];
    const origUpdate = storage.updateDownloadStatus.bind(storage);
    storage.updateDownloadStatus = (id: string, status: string) => {
      if (status === 'downloading') started.push(id);
      origUpdate(id, status);
    };

    const queue = new DownloadQueue(storage as any, '/tmp/nonexistent-dl-dir');
    queue.pauseAll();

    expect(started).toHaveLength(1);
    for (const id of ['p1', 'p2', 'p3']) {
      expect(storage.downloads.get(id).status).toBe('paused');
    }
  });
});
