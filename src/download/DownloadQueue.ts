import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { app } from 'electron';
import { Downloader } from './Downloader';
import type { DownloadProgress, DownloadQueueItem } from './download.types';
import type { StorageService } from '../storage/StorageService';

const MAX_DOWNLOAD_SIZE = 10 * 1024 * 1024 * 1024; // 10 GB

function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '_')
    .trim()
    .slice(0, 200);
}

function removePartFiles(chunks: { tempPath: string }[]): void {
  for (const chunk of chunks) {
    try {
      fs.rmSync(chunk.tempPath, { force: true });
    } catch {
      /* ignore — a still-open handle on Windows; the next attempt truncates it */
    }
  }
}

export class DownloadQueue extends EventEmitter {
  private storage: StorageService;
  private downloadsDir: string;
  private activeDownloader: Downloader | null = null;
  private activeDownloadId: string | null = null;

  constructor(storage: StorageService, downloadsDir?: string) {
    super();
    this.storage = storage;
    this.downloadsDir = downloadsDir ?? path.join(app.getPath('downloads'), 'AnimeciX');

    // Crash recovery: reset any 'downloading' items to 'queued'
    const incomplete = this.storage.getIncompleteDownloads();
    for (const item of incomplete) {
      if (item.status === 'downloading') {
        this.storage.updateDownloadStatus(item.id, 'queued');
      }
    }

    this.processNext();
  }

  async add(
    episodeId: string,
    url: string,
    title: string,
    subUrls: { language: string; url: string }[],
  ): Promise<string> {
    Downloader.validateUrl(url);

    // Ensure downloads directory exists
    if (!fs.existsSync(this.downloadsDir)) {
      fs.mkdirSync(this.downloadsDir, { recursive: true });
    }

    const id = episodeId;
    const safeName = sanitizeFilename(title);
    const outputPath = path.join(this.downloadsDir, safeName + '.mp4');

    // The row id is the episodeId, so a second add used to hit the PRIMARY KEY
    // and throw: an episode that was ever paused, cancelled mid-flight or failed
    // could never be downloaded again (batch download showed "hata" forever).
    const existing = this.storage.getDownloadById(id);
    if (existing) {
      if (existing.status === 'completed' && fs.existsSync(existing.outputPath)) {
        return id;
      }
      if (existing.status === 'downloading' || existing.status === 'queued') {
        return id;
      }
      // paused / failed / completed-but-file-gone: start over with the fresh
      // URL from the caller (the stored one may be an expired signed URL).
      this.discard(existing);
    }

    // HEAD request to get Content-Length
    const totalBytes = await this.getContentLength(url);

    // 0 means the size is unknown (HEAD failed or no Content-Length); with no
    // chunks the download used to "complete" instantly as a 0-byte file.
    if (totalBytes <= 0) {
      throw new Error('Could not determine file size');
    }

    if (totalBytes > MAX_DOWNLOAD_SIZE) {
      throw new Error(
        `File size ${totalBytes} exceeds maximum allowed size of ${MAX_DOWNLOAD_SIZE} bytes`,
      );
    }

    const chunkDefs = Downloader.splitIntoChunks(totalBytes, 4);
    const chunks = chunkDefs.map((c, i) => ({
      chunkIndex: i,
      byteStart: c.start,
      byteEnd: c.end,
      tempPath: outputPath + '.part' + i,
    }));
    // Leftovers from an earlier attempt would otherwise be appended to.
    removePartFiles(chunks);

    this.storage.enqueueDownload({
      id,
      episodeId,
      title,
      url,
      subUrls: JSON.stringify(subUrls),
      outputPath,
      totalBytes,
      chunks,
    });

    this.processNext();
    return id;
  }

  pause(id: string): void {
    this.stopActive(id, 'paused');
    // Pausing the active item used to stall the whole queue.
    this.processNext();
  }

  resume(id: string): void {
    this.storage.updateDownloadStatus(id, 'queued');
    this.processNext();
  }

  cancel(id: string): void {
    const item = this.storage.getDownloadById(id);
    if (item) {
      this.discard(item);
      // The library entry was created at enqueue time; without a finished file
      // it is an undeletable 0 MB row.
      if (item.status !== 'completed') {
        this.storage.deleteEpisodeMetadata(item.episodeId);
      }
    }
    this.processNext();
  }

  pauseAll(): void {
    // Mark queued items first so pausing the active one cannot start them.
    for (const item of this.storage.getAllDownloads()) {
      if (item.status === 'queued') {
        this.storage.updateDownloadStatus(item.id, 'paused');
      }
    }
    if (this.activeDownloadId) {
      this.stopActive(this.activeDownloadId, 'paused');
    }
  }

  /** Aborts the item if it is the active download, then records its status. */
  private stopActive(id: string, status: 'paused'): void {
    if (this.activeDownloadId === id && this.activeDownloader) {
      this.activeDownloader.pause(); // aborts requests
      this.activeDownloader = null;
      this.activeDownloadId = null;
    }
    this.storage.updateDownloadStatus(id, status);
  }

  /** Stops the item if active and removes its row and part files. */
  private discard(item: DownloadQueueItem): void {
    if (this.activeDownloadId === item.id && this.activeDownloader) {
      this.activeDownloader.pause(); // aborts requests
      this.activeDownloader = null;
      this.activeDownloadId = null;
    }
    removePartFiles(item.chunks);
    this.storage.deleteDownload(item.id);
  }

  cancelAll(): void {
    const all = this.storage.getAllDownloads();
    for (const item of all) {
      if (item.status === 'downloading' || item.status === 'queued' || item.status === 'paused') {
        this.cancel(item.id);
      }
    }
  }

  getQueue(): DownloadProgress[] {
    const all = this.storage.getAllDownloads();
    return all.map((item) => {
      const downloadedBytes = item.chunks.reduce(
        (sum, c) => sum + c.bytesDownloaded,
        0,
      );
      return {
        id: item.id,
        episodeId: item.episodeId,
        title: item.title,
        status: item.status,
        progressPercent:
          item.totalBytes > 0 ? (downloadedBytes / item.totalBytes) * 100 : 0,
        speedBps: 0,
        totalBytes: item.totalBytes,
        downloadedBytes,
      };
    });
  }

  private processNext(): void {
    // Sequential: only 1 active download at a time
    if (this.activeDownloader) return;

    const incomplete = this.storage.getIncompleteDownloads();
    const next = incomplete.find((item) => item.status === 'queued');
    if (!next) {
      this.emit('queueEmpty');
      return;
    }

    this.activeDownloadId = next.id;
    this.storage.updateDownloadStatus(next.id, 'downloading');

    const downloader = new Downloader(
      next.url,
      next.outputPath,
      next.chunks,
      this.storage,
    );
    this.activeDownloader = downloader;

    downloader.on('progress', (progress: { downloadedBytes: number; totalBytes: number; speedBps: number }) => {
      this.emit('progress', {
        id: next.id,
        episodeId: next.episodeId,
        title: next.title,
        status: 'downloading' as const,
        progressPercent:
          progress.totalBytes > 0
            ? (progress.downloadedBytes / progress.totalBytes) * 100
            : 0,
        speedBps: progress.speedBps,
        totalBytes: progress.totalBytes,
        downloadedBytes: progress.downloadedBytes,
      });
    });

    downloader.on('complete', () => {
      this.storage.updateDownloadStatus(next.id, 'completed');
      this.activeDownloader = null;
      this.activeDownloadId = null;

      // Download subtitles
      this.downloadSubtitles(next)
        .catch(() => {
          // Subtitle download failure is non-fatal
        })
        .finally(() => {
          this.emit('downloadComplete', { id: next.id, episodeId: next.episodeId, title: next.title });
          this.processNext();
        });
    });

    downloader.on('error', (err: Error) => {
      this.storage.updateDownloadStatus(next.id, 'failed');
      this.activeDownloader = null;
      this.activeDownloadId = null;
      this.emit('error', { id: next.id, error: err });
      this.processNext();
    });

    downloader.start();
  }

  private async downloadSubtitles(item: DownloadQueueItem): Promise<void> {
    if (!item.subUrls || item.subUrls.length === 0) return;

    const dir = path.dirname(item.outputPath);
    const safeName = sanitizeFilename(item.title);

    for (const sub of item.subUrls) {
      const subPath = path.join(dir, `${safeName}.${sub.language}.ass`);
      await this.downloadFile(sub.url, subPath);
    }
  }

  private downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const httpModule = parsed.protocol === 'https:' ? https : http;

      const file = fs.createWriteStream(dest);
      httpModule
        .get(url, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            file.close();
            fs.unlinkSync(dest);
            this.downloadFile(res.headers.location, dest).then(resolve).catch(reject);
            return;
          }
          res.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        })
        .on('error', (err) => {
          file.close();
          try { fs.unlinkSync(dest); } catch { /* ignore */ }
          reject(err);
        });
    });
  }

  private getContentLength(url: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const httpModule = parsed.protocol === 'https:' ? https : http;

      const req = httpModule.request(url, { method: 'HEAD' }, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.getContentLength(new URL(res.headers.location, url).href).then(resolve).catch(reject);
          return;
        }
        // An error page's Content-Length is not the video's size.
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode} while checking file size`));
          return;
        }
        const len = parseInt(res.headers['content-length'] ?? '0', 10);
        resolve(len);
      });
      req.on('error', reject);
      req.end();
    });
  }
}
