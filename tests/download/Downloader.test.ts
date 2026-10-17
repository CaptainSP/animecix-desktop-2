import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Downloader } from '../../src/download/Downloader';

// --- splitIntoChunks unit tests (pure function) ---

describe('Downloader.splitIntoChunks', () => {
  it('splits 1000 bytes into 4 chunks', () => {
    const chunks = Downloader.splitIntoChunks(1000, 4);
    expect(chunks).toEqual([
      { start: 0, end: 249 },
      { start: 250, end: 499 },
      { start: 500, end: 749 },
      { start: 750, end: 999 },
    ]);
  });

  it('splits 10 bytes into 4 chunks with remainder in last', () => {
    const chunks = Downloader.splitIntoChunks(10, 4);
    expect(chunks).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 3 },
      { start: 4, end: 5 },
      { start: 6, end: 9 },
    ]);
  });

  it('handles single chunk', () => {
    const chunks = Downloader.splitIntoChunks(100, 1);
    expect(chunks).toEqual([{ start: 0, end: 99 }]);
  });

  it('returns empty for 0 bytes', () => {
    expect(Downloader.splitIntoChunks(0, 4)).toEqual([]);
  });
});

// --- URL validation ---

describe('Downloader.validateUrl', () => {
  it('accepts https URLs', () => {
    expect(() => Downloader.validateUrl('https://example.com/file.mp4')).not.toThrow();
  });

  it('accepts http URLs for localhost only', () => {
    expect(() => Downloader.validateUrl('http://127.0.0.1:3000/file.mp4')).not.toThrow();
    expect(() => Downloader.validateUrl('http://localhost:3000/file.mp4')).not.toThrow();
  });

  it('rejects http URLs for remote hosts', () => {
    expect(() => Downloader.validateUrl('http://example.com/file.mp4')).toThrow('Invalid URL scheme');
  });

  it('rejects file:// URLs', () => {
    expect(() => Downloader.validateUrl('file:///etc/passwd')).toThrow('Invalid URL scheme');
  });

  it('rejects data: URLs', () => {
    expect(() => Downloader.validateUrl('data:text/plain,hello')).toThrow('Invalid URL scheme');
  });

  it('rejects javascript: URLs', () => {
    expect(() => Downloader.validateUrl('javascript:alert(1)')).toThrow('Invalid URL scheme');
  });
});

// --- Download tests with local HTTP server ---

describe('Downloader download', () => {
  let server: http.Server;
  let port: number;
  let tmpDir: string;
  const testData = Buffer.alloc(4000, 'abcdefghij');

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        server = http.createServer((req, res) => {
          const rangeHeader = req.headers.range;
          if (rangeHeader) {
            const match = rangeHeader.match(/bytes=(\d+)-(\d+)?/);
            if (match) {
              const start = parseInt(match[1], 10);
              const end = match[2] ? parseInt(match[2], 10) : testData.length - 1;
              const chunk = testData.subarray(start, end + 1);
              res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${testData.length}`,
                'Content-Length': chunk.length,
                'Accept-Ranges': 'bytes',
              });
              res.end(chunk);
              return;
            }
          }
          res.writeHead(200, {
            'Content-Length': testData.length,
            'Accept-Ranges': 'bytes',
          });
          res.end(testData);
        });
        server.listen(0, () => {
          port = (server.address() as { port: number }).port;
          resolve();
        });
      }),
  );

  afterAll(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  );

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeMockStorage() {
    return {
      updateChunkProgress: (_did: string, _ci: number, _bd: number, _c: boolean) => {},
    } as any;
  }

  it('downloads and merges chunks', async () => {
    const outputPath = path.join(tmpDir, 'output.mp4');
    const chunkDefs = Downloader.splitIntoChunks(testData.length, 4);
    const chunks = chunkDefs.map((c, i) => ({
      downloadId: 'test-dl',
      chunkIndex: i,
      byteStart: c.start,
      byteEnd: c.end,
      bytesDownloaded: 0,
      tempPath: path.join(tmpDir, `chunk-${i}.part`),
      completed: false,
    }));

    const storage = makeMockStorage();
    const downloader = new Downloader(
      `http://127.0.0.1:${port}/file.mp4`,
      outputPath,
      chunks,
      storage,
    );

    await new Promise<void>((resolve, reject) => {
      downloader.on('complete', resolve);
      downloader.on('error', reject);
      downloader.start();
    });

    const result = fs.readFileSync(outputPath);
    expect(result.length).toBe(testData.length);
    expect(result.equals(testData)).toBe(true);
  });

  it('emits progress events', async () => {
    const outputPath = path.join(tmpDir, 'output.mp4');
    const chunkDefs = Downloader.splitIntoChunks(testData.length, 2);
    const chunks = chunkDefs.map((c, i) => ({
      downloadId: 'test-dl',
      chunkIndex: i,
      byteStart: c.start,
      byteEnd: c.end,
      bytesDownloaded: 0,
      tempPath: path.join(tmpDir, `chunk-${i}.part`),
      completed: false,
    }));

    const storage = makeMockStorage();
    const downloader = new Downloader(
      `http://127.0.0.1:${port}/file.mp4`,
      outputPath,
      chunks,
      storage,
    );

    const progressEvents: any[] = [];
    downloader.on('progress', (p: any) => progressEvents.push(p));

    await new Promise<void>((resolve, reject) => {
      downloader.on('complete', resolve);
      downloader.on('error', reject);
      downloader.start();
    });

    expect(progressEvents.length).toBeGreaterThan(0);
    const last = progressEvents[progressEvents.length - 1];
    expect(last).toHaveProperty('downloadedBytes');
    expect(last).toHaveProperty('totalBytes');
    expect(last).toHaveProperty('speedBps');
  });

  it('emits error on invalid URL scheme', async () => {
    const outputPath = path.join(tmpDir, 'output.mp4');
    const downloader = new Downloader('file:///etc/passwd', outputPath, [], makeMockStorage());

    const error = await new Promise<Error>((resolve) => {
      downloader.on('error', resolve);
      downloader.start();
    });

    expect(error.message).toContain('Invalid URL scheme');
  });

  it('pause aborts and emits paused', async () => {
    const outputPath = path.join(tmpDir, 'output.mp4');
    const chunkDefs = Downloader.splitIntoChunks(testData.length, 2);
    const chunks = chunkDefs.map((c, i) => ({
      downloadId: 'test-dl',
      chunkIndex: i,
      byteStart: c.start,
      byteEnd: c.end,
      bytesDownloaded: 0,
      tempPath: path.join(tmpDir, `chunk-${i}.part`),
      completed: false,
    }));

    const storage = makeMockStorage();
    const downloader = new Downloader(
      `http://127.0.0.1:${port}/file.mp4`,
      outputPath,
      chunks,
      storage,
    );

    const paused = new Promise<void>((resolve) => {
      downloader.on('paused', resolve);
    });

    downloader.start();
    downloader.pause();
    await paused;
  });

  function makeChunks(threads: number, bytesDownloaded = 0) {
    return Downloader.splitIntoChunks(testData.length, threads).map((c, i) => ({
      downloadId: 'test-dl',
      chunkIndex: i,
      byteStart: c.start,
      byteEnd: c.end,
      bytesDownloaded,
      tempPath: path.join(tmpDir, `chunk-${i}.part`),
      completed: false,
    }));
  }

  function run(downloader: Downloader): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      downloader.on('complete', resolve);
      downloader.on('error', reject);
      downloader.start();
    });
  }

  it('resumes correctly when the part file is ahead of the stored progress', async () => {
    // Progress is persisted every ~1 MB, so after a pause the file holds more
    // bytes than the database says. Appending from the stored offset used to
    // duplicate those bytes.
    const chunks = makeChunks(2, 100);
    fs.writeFileSync(chunks[0].tempPath, testData.subarray(0, 700));
    fs.writeFileSync(chunks[1].tempPath, testData.subarray(2000, 2300));
    const outputPath = path.join(tmpDir, 'output.mp4');

    await run(new Downloader(`http://127.0.0.1:${port}/file.mp4`, outputPath, chunks, makeMockStorage()));

    expect(fs.readFileSync(outputPath).equals(testData)).toBe(true);
  });

  it('ignores a leftover part file from an earlier attempt', async () => {
    const chunks = makeChunks(2, 0);
    fs.writeFileSync(chunks[0].tempPath, 'garbage from an older download');
    const outputPath = path.join(tmpDir, 'output.mp4');

    await run(new Downloader(`http://127.0.0.1:${port}/file.mp4`, outputPath, chunks, makeMockStorage()));

    expect(fs.readFileSync(outputPath).equals(testData)).toBe(true);
  });

  it('reopens a chunk marked complete whose part file is short', async () => {
    const chunks = makeChunks(2, 0).map((c) => ({ ...c, completed: true, bytesDownloaded: 2000 }));
    fs.writeFileSync(chunks[0].tempPath, testData.subarray(0, 2000));
    fs.writeFileSync(chunks[1].tempPath, testData.subarray(2000, 2500));
    const outputPath = path.join(tmpDir, 'output.mp4');

    await run(new Downloader(`http://127.0.0.1:${port}/file.mp4`, outputPath, chunks, makeMockStorage()));

    expect(fs.readFileSync(outputPath).equals(testData)).toBe(true);
  });

  it('fails instead of corrupting the file when the server ignores Range', async () => {
    const noRange = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Length': testData.length });
      res.end(testData);
    });
    await new Promise<void>((resolve) => noRange.listen(0, resolve));
    const noRangePort = (noRange.address() as { port: number }).port;

    try {
      const outputPath = path.join(tmpDir, 'output.mp4');
      const downloader = new Downloader(
        `http://127.0.0.1:${noRangePort}/file.mp4`,
        outputPath,
        makeChunks(2),
        makeMockStorage(),
      );
      await expect(run(downloader)).rejects.toThrow('HTTP 200');
      expect(fs.existsSync(outputPath)).toBe(false);
    } finally {
      await new Promise<void>((resolve) => noRange.close(() => resolve()));
    }
  });

  it('emits a single error and stops sibling chunks when one chunk fails', async () => {
    const flaky = http.createServer((req, res) => {
      const match = (req.headers.range ?? '').match(/bytes=(\d+)-(\d+)/);
      const start = match ? parseInt(match[1], 10) : 0;
      if (start === 0) {
        res.writeHead(500);
        res.end();
        return;
      }
      const end = match ? parseInt(match[2], 10) : testData.length - 1;
      res.writeHead(206, { 'Content-Length': end - start + 1 });
      res.write(testData.subarray(start, start + 10));
      // never finishes — must be aborted by the failing sibling
    });
    await new Promise<void>((resolve) => flaky.listen(0, resolve));
    const flakyPort = (flaky.address() as { port: number }).port;

    try {
      const downloader = new Downloader(
        `http://127.0.0.1:${flakyPort}/file.mp4`,
        path.join(tmpDir, 'output.mp4'),
        makeChunks(4),
        makeMockStorage(),
      );
      const errors: Error[] = [];
      downloader.on('error', (e: Error) => errors.push(e));
      downloader.start();
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('HTTP 500');
      expect((downloader as any).activeRequests).toHaveLength(0);
    } finally {
      flaky.closeAllConnections();
      await new Promise<void>((resolve) => flaky.close(() => resolve()));
    }
  });

  it('refuses to merge when a part file is short', async () => {
    const chunks = makeChunks(2).map((c) => ({ ...c, completed: true }));
    fs.writeFileSync(chunks[0].tempPath, testData.subarray(0, 2000));
    fs.writeFileSync(chunks[1].tempPath, testData.subarray(2000, 2100));
    const downloader = new Downloader(
      `http://127.0.0.1:${port}/file.mp4`,
      path.join(tmpDir, 'output.mp4'),
      chunks,
      makeMockStorage(),
    );

    await expect(downloader.mergeChunks()).rejects.toThrow('Chunk 1 has 100 bytes');
    expect(fs.existsSync(chunks[1].tempPath)).toBe(true);
  });
});
