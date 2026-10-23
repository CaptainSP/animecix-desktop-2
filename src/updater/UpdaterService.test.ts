import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// --- Mock electron-updater (use vi.hoisted so mock is available when vi.mock runs) ---
const { mockAutoUpdater, mockLog } = vi.hoisted(() => {
  const emitter = new (require('node:events').EventEmitter)() as any;
  emitter.logger = null;
  emitter.autoDownload = false;
  emitter.allowPrerelease = true;
  emitter.forceDevUpdateConfig = false;
  emitter.checkForUpdates = vi.fn().mockResolvedValue(undefined);
  emitter.quitAndInstall = vi.fn();
  return {
    mockAutoUpdater: emitter,
    mockLog: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
});

vi.mock('electron-updater', () => ({
  autoUpdater: mockAutoUpdater,
}));

vi.mock('electron-log', () => ({
  default: mockLog,
}));

// --- Mock electron app ---
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
}));

import { UpdaterService, isAutoUpdateSupported } from './UpdaterService.js';
import { UPDATER_CHANNELS } from '../types/updater.js';

const INITIAL_DELAY = 30_000;
const RECURRING_INTERVAL = 4 * 60 * 60 * 1000;

describe('UpdaterService', () => {
  let service: UpdaterService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Pretend to be an AppImage so init() takes the enabled path even when
    // the suite itself runs on Linux (CI uses ubuntu-latest).
    vi.stubEnv('APPIMAGE', '/fake/AnimeciX.AppImage');
    // Reset mock autoUpdater event listeners
    mockAutoUpdater.removeAllListeners();
    mockAutoUpdater.checkForUpdates = vi.fn().mockResolvedValue(undefined);
    mockAutoUpdater.quitAndInstall = vi.fn();
    mockAutoUpdater.autoDownload = false;
    mockAutoUpdater.allowPrerelease = true;
    mockAutoUpdater.forceDevUpdateConfig = false;
    service = new UpdaterService();
  });

  afterEach(() => {
    service.dispose();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  // Test 1: init() schedules first check via setTimeout with 30s delay
  it('schedules initial check after 30s delay', async () => {
    service.init();
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(INITIAL_DELAY);
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  // Test 2: init() schedules recurring checks every 4h
  it('schedules recurring checks every 4 hours', async () => {
    service.init();

    // First check at 30s
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY);
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

    // 4h interval — second check
    await vi.advanceTimersByTimeAsync(RECURRING_INTERVAL);
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);

    // 4h interval — third check
    await vi.advanceTimersByTimeAsync(RECURRING_INTERVAL);
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(3);
  });

  // Test 3: manualCheck() calls checkForUpdates immediately regardless of timers
  it('manualCheck() calls checkForUpdates immediately', async () => {
    service.init();
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();

    await service.manualCheck();
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  // Test 4: error handler logs via electron-log and does NOT rethrow
  it('logs errors silently without rethrowing or emitting to banner', () => {
    const eventListener = vi.fn();
    service.onEvent(eventListener);
    service.init();

    const testError = new Error('update check failed');
    mockAutoUpdater.emit('error', testError);

    expect(mockLog.error).toHaveBeenCalled();
    // Should NOT emit to banner (UPDATE_READY or any channel via eventListener)
    expect(eventListener).not.toHaveBeenCalled();
  });

  // Test 5: update-downloaded emits UPDATE_READY with version from payload
  it('emits UPDATE_READY when update-downloaded fires', () => {
    const eventListener = vi.fn();
    service.onEvent(eventListener);
    service.init();

    mockAutoUpdater.emit('update-downloaded', {
      version: '2.0.0',
      releaseNotes: 'New stuff',
    });

    expect(eventListener).toHaveBeenCalledWith(UPDATER_CHANNELS.UPDATE_READY, {
      version: '2.0.0',
      releaseNotes: 'New stuff',
    });
  });

  // Test 6: dismissBannerForSession suppresses subsequent update-downloaded events
  it('dismissBannerForSession suppresses further UPDATE_READY events this session', () => {
    const eventListener = vi.fn();
    service.onEvent(eventListener);
    service.init();

    // Dismiss banner
    service.dismissBannerForSession();

    // Subsequent update-downloaded should be suppressed
    mockAutoUpdater.emit('update-downloaded', {
      version: '2.0.0',
      releaseNotes: 'New stuff',
    });

    expect(eventListener).not.toHaveBeenCalledWith(
      UPDATER_CHANNELS.UPDATE_READY,
      expect.anything(),
    );
  });

  // Test 7: dispose() clears both timeout and interval
  it('dispose() clears timers so no further checks fire', async () => {
    service.init();
    service.dispose();

    // Advance past both the initial 30s and one interval
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY + RECURRING_INTERVAL);
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  // Test 8: init() is a no-op on Linux deb/rpm (no AppImage) — electron-updater
  // has no update path there, so nothing may be scheduled or subscribed.
  it('init() schedules nothing on Linux without AppImage', async () => {
    vi.stubEnv('APPIMAGE', '');
    const realPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      const debService = new UpdaterService();
      debService.init();

      await vi.advanceTimersByTimeAsync(INITIAL_DELAY + RECURRING_INTERVAL);
      expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
      expect(mockAutoUpdater.listenerCount('update-downloaded')).toBe(0);
      debService.dispose();
    } finally {
      Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
    }
  });
});

describe('isAutoUpdateSupported', () => {
  it('returns false on Linux without AppImage (deb/rpm)', () => {
    expect(isAutoUpdateSupported('linux', undefined)).toBe(false);
    expect(isAutoUpdateSupported('linux', '')).toBe(false);
  });

  it('returns true on Linux AppImage', () => {
    expect(isAutoUpdateSupported('linux', '/opt/AnimeciX.AppImage')).toBe(true);
  });

  it('returns true on Windows and macOS regardless of AppImage', () => {
    expect(isAutoUpdateSupported('win32', undefined)).toBe(true);
    expect(isAutoUpdateSupported('darwin', undefined)).toBe(true);
  });
});
