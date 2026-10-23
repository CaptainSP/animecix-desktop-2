import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import { markQuitting } from '../window/WindowService.js';
import {
  UPDATER_CHANNELS,
  type UpdateReadyPayload,
  type DownloadProgressPayload,
} from '../types/updater.js';

const INITIAL_CHECK_DELAY_MS = 30_000;                   // D-13: 30s after launch
const RECURRING_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;  // D-13: every 4 hours

type EventListener = (channel: string, payload: unknown) => void;

/**
 * electron-updater only ships an update path for AppImage on Linux — a
 * deb/rpm install has nothing to update itself with, so every check just
 * errors. Report support once so main.ts and the tray menu can stay quiet.
 * Pure/testable: platform and APPIMAGE are injectable (defaults read the
 * real process values).
 */
export function isAutoUpdateSupported(
  platform: NodeJS.Platform = process.platform,
  appImage: string | undefined = process.env.APPIMAGE,
): boolean {
  return platform !== 'linux' || !!appImage;
}

export class UpdaterService {
  private initialCheckTimer: NodeJS.Timeout | null = null;
  private recurringCheckTimer: NodeJS.Timeout | null = null;
  private eventListener: EventListener | null = null;
  private bannerDismissedThisSession = false; // D-16

  init(): void {
    if (!isAutoUpdateSupported()) {
      // deb/rpm installs: skip scheduling entirely — checkForUpdates would
      // just log an error every 4 hours. Users update via apt/dnf.
      log.info('[updater] disabled: auto-update is only supported on AppImage for Linux');
      return;
    }
    autoUpdater.logger = log;
    autoUpdater.autoDownload = true;       // D-14: background download, no user approval
    autoUpdater.allowPrerelease = false;   // D-12: stable channel only

    if (!app.isPackaged) {
      // D-13: in dev, use dev-app-update.yml so update checks don't crash
      autoUpdater.forceDevUpdateConfig = true;
      log.info('[updater] dev mode: forceDevUpdateConfig = true');
    }

    autoUpdater.on('checking-for-update', () => {
      log.info('[updater] Checking for update...');
    });

    autoUpdater.on('update-available', (info) => {
      log.info('[updater] Update available:', info.version);
      this.emit(UPDATER_CHANNELS.UPDATE_AVAILABLE, { version: info.version });
    });

    autoUpdater.on('update-not-available', () => {
      log.info('[updater] Up to date.');
      this.emit(UPDATER_CHANNELS.UPDATE_NOT_AVAILABLE, null);
    });

    autoUpdater.on('download-progress', (progress) => {
      const payload: DownloadProgressPayload = {
        percent: Math.round(progress.percent),
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      };
      this.emit(UPDATER_CHANNELS.DOWNLOAD_PROGRESS, payload);
    });

    autoUpdater.on('update-downloaded', (info) => {
      log.info('[updater] Update downloaded:', info.version);
      if (this.bannerDismissedThisSession) {
        // D-16: suppress if user already dismissed banner this session
        log.info('[updater] Banner dismissed this session — suppressing UPDATE_READY');
        return;
      }
      const payload: UpdateReadyPayload = {
        version: info.version,
        releaseNotes: String(info.releaseNotes ?? ''),
      };
      this.emit(UPDATER_CHANNELS.UPDATE_READY, payload);
    });

    autoUpdater.on('error', (err) => {
      // D-13: silent failure — log only, NEVER dialog, NEVER rethrow
      log.error('[updater] Error:', err?.message ?? String(err));
    });

    // D-13: initial check after 30s delay (avoids first-run jank)
    this.initialCheckTimer = setTimeout(
      () =>
        autoUpdater
          .checkForUpdates()
          .catch((e) => log.error('[updater] initial check failed:', (e as Error)?.message)),
      INITIAL_CHECK_DELAY_MS,
    );

    // D-13: recurring check every 4h
    this.recurringCheckTimer = setInterval(
      () =>
        autoUpdater
          .checkForUpdates()
          .catch((e) => log.error('[updater] recurring check failed:', (e as Error)?.message)),
      RECURRING_CHECK_INTERVAL_MS,
    );
  }

  async manualCheck(): Promise<void> {
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      log.error('[updater] manual check failed:', (e as Error)?.message);
    }
  }

  async install(): Promise<void> {
    log.info('[updater] quitAndInstall');
    // Bypass macOS close-to-hide so app.quit() actually exits
    markQuitting();
    autoUpdater.quitAndInstall(false, true);
    // Squirrel.Mac waits for the app to exit before installing.
    // quitAndInstall triggers app.quit() but that can be intercepted.
    // Force exit after a short delay to unblock ShipIt.
    setTimeout(() => app.exit(0), 1500);
  }

  dismissBannerForSession(): void {
    this.bannerDismissedThisSession = true;
    log.info('[updater] banner dismissed for this session');
  }

  onEvent(listener: EventListener): void {
    this.eventListener = listener;
  }

  dispose(): void {
    if (this.initialCheckTimer) {
      clearTimeout(this.initialCheckTimer);
      this.initialCheckTimer = null;
    }
    if (this.recurringCheckTimer) {
      clearInterval(this.recurringCheckTimer);
      this.recurringCheckTimer = null;
    }
  }

  private emit(channel: string, payload: unknown): void {
    this.eventListener?.(channel, payload);
  }
}
