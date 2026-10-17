import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { pipeline } from 'node:stream/promises';
import type { ChunkState } from './download.types';
import type { StorageService } from '../storage/StorageService';

const MAX_DOWNLOAD_SIZE = 10 * 1024 * 1024 * 1024; // 10 GB
const PROGRESS_PERSIST_INTERVAL = 1024 * 1024; // 1 MB
const MAX_REDIRECTS = 5;

export class Downloader extends EventEmitter {
  private url: string;
  private outputPath: string;
  private chunks: ChunkState[];
  private storage: StorageService;
  private activeRequests: http.ClientRequest[] = [];
  private isPaused = false;
  /** Set once a chunk fails so sibling chunks stop and 'error' fires only once. */
  private hasFailed = false;
  private speedSamples: { time: number; bytes: number }[] = [];

  constructor(
    url: string,
    outputPath: string,
    chunks: ChunkState[],
    storage: StorageService,
  ) {
    super();
    this.url = url;
    this.outputPath = outputPath;
    this.chunks = chunks;
    this.storage = storage;
  }

  static splitIntoChunks(
    totalBytes: number,
    threadCount = 4,
  ): { start: number; end: number }[] {
    if (totalBytes <= 0 || threadCount <= 0) return [];
    const chunkSize = Math.floor(totalBytes / threadCount);
    const chunks: { start: number; end: number }[] = [];
    for (let i = 0; i < threadCount; i++) {
      const start = i * chunkSize;
      const end = i === threadCount - 1 ? totalBytes - 1 : (i + 1) * chunkSize - 1;
      chunks.push({ start, end });
    }
    return chunks;
  }

  static validateUrl(url: string): void {
    const parsed = new URL(url);
    const isLoopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
      throw new Error(
        `Invalid URL scheme: ${parsed.protocol} — only https: is allowed (http: only for localhost)`,
      );
    }
  }

  start(): void {
    this.isPaused = false;
    this.hasFailed = false;
    this.activeRequests = [];

    try {
      Downloader.validateUrl(this.url);
    } catch (err) {
      this.emit('error', err);
      return;
    }

    // A chunk marked complete whose part file is short (killed mid-write, or
    // removed) would fail the merge on every retry; reopen it instead.
    for (const chunk of this.chunks) {
      if (chunk.completed && !this.partFileIsComplete(chunk)) {
        chunk.completed = false;
      }
    }

    const incompleteChunks = this.chunks.filter((c) => !c.completed);
    if (incompleteChunks.length === 0) {
      this.mergeChunks()
        .then(() => this.emit('complete'))
        .catch((err) => this.emit('error', err));
      return;
    }

    let completedCount = this.chunks.filter((c) => c.completed).length;
    const totalChunks = this.chunks.length;

    for (const chunk of incompleteChunks) {
      this.downloadChunk(chunk, this.url)
        .then(() => {
          completedCount++;
          if (completedCount === totalChunks) {
            this.mergeChunks()
              .then(() => this.emit('complete'))
              .catch((err) => this.emit('error', err));
          }
        })
        .catch((err) => this.fail(err));
    }
  }

  pause(): void {
    this.isPaused = true;
    this.abortRequests();
    this.emit('paused');
  }

  /**
   * Without this, the remaining chunks kept downloading after one failed while
   * the queue had already marked the item failed and started the next one —
   * two downloads writing at once, and stale writers holding .part files open.
   */
  private fail(err: Error): void {
    if (this.isPaused || this.hasFailed) return;
    this.hasFailed = true;
    this.abortRequests();
    this.emit('error', err);
  }

  private abortRequests(): void {
    for (const req of this.activeRequests) {
      req.destroy();
    }
    this.activeRequests = [];
  }

  private get totalBytes(): number {
    return this.chunks.reduce((sum, c) => sum + (c.byteEnd - c.byteStart + 1), 0);
  }

  private partFileIsComplete(chunk: ChunkState): boolean {
    try {
      return fs.statSync(chunk.tempPath).size === chunk.byteEnd - chunk.byteStart + 1;
    } catch {
      return false;
    }
  }

  /**
   * Makes the .part file and bytesDownloaded agree before resuming.
   *
   * Progress is persisted only every PROGRESS_PERSIST_INTERVAL, so after a
   * pause/crash the file is usually longer than the stored count. Appending
   * from the stored offset then duplicated up to 1 MB per chunk and produced a
   * corrupt video. The stored count is the safe point (every byte before it
   * was received), so a longer file is truncated to it; a shorter file (write
   * not flushed) wins instead. A leftover file from an older attempt with a
   * stored count of 0 is truncated to empty.
   */
  private syncChunkWithFile(chunk: ChunkState): void {
    let fileSize = 0;
    try {
      fileSize = fs.statSync(chunk.tempPath).size;
    } catch {
      /* no part file yet */
    }
    const chunkLength = chunk.byteEnd - chunk.byteStart + 1;
    const safeBytes = Math.min(chunk.bytesDownloaded, fileSize, chunkLength);
    if (fileSize > safeBytes) {
      fs.truncateSync(chunk.tempPath, safeBytes);
    }
    chunk.bytesDownloaded = safeBytes;
  }

  resume(): void {
    this.start();
  }

  private downloadChunk(chunk: ChunkState, url: string, redirectCount = 0): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isPaused) {
        reject(new Error('Download paused'));
        return;
      }

      if (redirectCount === 0) {
        try {
          this.syncChunkWithFile(chunk);
        } catch (err) {
          reject(err as Error);
          return;
        }
      }

      const rangeStart = chunk.byteStart + chunk.bytesDownloaded;
      const rangeEnd = chunk.byteEnd;

      if (rangeStart > rangeEnd) {
        chunk.completed = true;
        this.storage.updateChunkProgress(
          chunk.downloadId,
          chunk.chunkIndex,
          chunk.bytesDownloaded,
          true,
        );
        resolve();
        return;
      }

      const parsed = new URL(url);
      const httpModule = parsed.protocol === 'https:' ? https : http;

      const req = httpModule.get(
        url,
        {
          headers: {
            Range: `bytes=${rangeStart}-${rangeEnd}`,
          },
        },
        (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            // Follow redirect with HTTPS validation and depth limit
            req.destroy();
            const redirectUrl = res.headers.location;
            if (redirectCount >= MAX_REDIRECTS) {
              reject(new Error(`Too many redirects (max ${MAX_REDIRECTS})`));
              return;
            }
            try {
              const redirectParsed = new URL(redirectUrl, url);
              if (redirectParsed.protocol !== 'https:') {
                reject(new Error(`Redirect to non-HTTPS URL: ${redirectParsed.protocol}`));
                return;
              }
              this.downloadChunk(chunk, redirectParsed.href, redirectCount + 1).then(resolve).catch(reject);
            } catch {
              reject(new Error('Invalid redirect URL'));
            }
            return;
          }

          // A 200 carries the whole file, which is only correct when the whole
          // file was asked for; otherwise the server ignored Range and writing
          // the body into this chunk would corrupt the merged video.
          const isWholeFile = rangeStart === 0 && rangeEnd === this.totalBytes - 1;
          if (res.statusCode !== 206 && !(res.statusCode === 200 && isWholeFile)) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode} for chunk ${chunk.chunkIndex}`));
            return;
          }

          const writer = fs.createWriteStream(chunk.tempPath, { flags: 'a' });
          let bytesSinceLastPersist = 0;

          // Release the file handle when the request is aborted (pause/cancel/
          // sibling failure); on Windows an open handle blocks deleting the part.
          res.on('close', () => {
            if (!writer.writableEnded) writer.end();
          });

          res.on('data', (data: Buffer) => {
            if (this.isPaused || this.hasFailed) {
              req.destroy();
              if (!writer.writableEnded) writer.end();
              return;
            }

            chunk.bytesDownloaded += data.length;
            bytesSinceLastPersist += data.length;

            // Track speed
            this.speedSamples.push({ time: Date.now(), bytes: data.length });
            const cutoff = Date.now() - 3000;
            this.speedSamples = this.speedSamples.filter((s) => s.time > cutoff);

            // Persist progress every ~1 MB
            if (bytesSinceLastPersist >= PROGRESS_PERSIST_INTERVAL) {
              this.storage.updateChunkProgress(
                chunk.downloadId,
                chunk.chunkIndex,
                chunk.bytesDownloaded,
                false,
              );
              bytesSinceLastPersist = 0;
            }

            // Emit progress
            const totalDownloaded = this.chunks.reduce(
              (sum, c) => sum + c.bytesDownloaded,
              0,
            );
            const totalBytes = this.totalBytes;
            const speedBps = this.calculateSpeed();

            this.emit('progress', {
              downloadedBytes: totalDownloaded,
              totalBytes,
              speedBps,
            });
          });

          res.on('end', () => {
            writer.end(() => {
              if (this.isPaused || this.hasFailed) return;
              if (chunk.byteStart + chunk.bytesDownloaded - 1 < chunk.byteEnd) {
                // Connection closed early; persist what arrived so a retry resumes.
                this.storage.updateChunkProgress(
                  chunk.downloadId,
                  chunk.chunkIndex,
                  chunk.bytesDownloaded,
                  false,
                );
                reject(new Error(`Chunk ${chunk.chunkIndex} ended early`));
                return;
              }
              chunk.completed = true;
              this.storage.updateChunkProgress(
                chunk.downloadId,
                chunk.chunkIndex,
                chunk.bytesDownloaded,
                true,
              );
              resolve();
            });
          });

          res.on('error', (err) => {
            writer.end();
            reject(err);
          });

          res.pipe(writer, { end: false });
        },
      );

      req.on('error', (err) => {
        if (!this.isPaused && !this.hasFailed) {
          reject(err);
        }
      });

      this.activeRequests.push(req);
    });
  }

  private calculateSpeed(): number {
    if (this.speedSamples.length === 0) return 0;
    const cutoff = Date.now() - 3000;
    const recent = this.speedSamples.filter((s) => s.time > cutoff);
    if (recent.length === 0) return 0;
    const totalBytes = recent.reduce((sum, s) => sum + s.bytes, 0);
    const elapsed = (Date.now() - recent[0].time) / 1000;
    return elapsed > 0 ? totalBytes / elapsed : 0;
  }

  async mergeChunks(): Promise<void> {
    const sorted = [...this.chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
    if (sorted.length === 0) {
      throw new Error('Nothing to merge: download has no chunks');
    }

    // Refuse to produce a short/corrupt video (it used to show up in the
    // library as a broken entry). Parts are kept so a retry can resume.
    for (const chunk of sorted) {
      const expected = chunk.byteEnd - chunk.byteStart + 1;
      let actual = -1;
      try {
        actual = fs.statSync(chunk.tempPath).size;
      } catch {
        /* missing part — reported below */
      }
      if (actual !== expected) {
        throw new Error(
          `Chunk ${chunk.chunkIndex} has ${actual} bytes, expected ${expected}`,
        );
      }
    }

    const output = fs.createWriteStream(this.outputPath);

    for (const chunk of sorted) {
      const input = fs.createReadStream(chunk.tempPath);
      await pipeline(input, output, { end: false });
      fs.unlinkSync(chunk.tempPath);
    }

    output.end();
    await new Promise<void>((resolve, reject) => {
      output.on('finish', resolve);
      output.on('error', reject);
    });
  }
}
