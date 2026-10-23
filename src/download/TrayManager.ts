import { Tray, Menu, app, BrowserWindow, nativeImage } from 'electron';
import path from 'node:path';
import { DownloadQueue } from './DownloadQueue';
import type { UpdaterService } from '../updater/UpdaterService.js';
import { markQuitting } from '../window/WindowService';

export class TrayManager {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow;
  private queue: DownloadQueue;
  private updater: UpdaterService | null = null;

  constructor(mainWindow: BrowserWindow, queue: DownloadQueue) {
    this.mainWindow = mainWindow;
    this.queue = queue;
  }

  setUpdaterService(service: UpdaterService): void {
    this.updater = service;
    // Re-build menu now that updater is available (enables the menu item)
    this.rebuildMenu();
  }

  hasActiveDownloads(): boolean {
    const q = this.queue.getQueue();
    return q.some(item => item.status === 'downloading' || item.status === 'queued');
  }

  createTray(): void {
    if (this.tray) return;
    // assets/tray-icon.png does not exist in the repo — fall back to the app
    // icon. Packaged builds resolve under resourcesPath, dev under app path.
    const baseDir = app.isPackaged
      ? process.resourcesPath
      : path.join(app.getAppPath(), 'assets');
    let icon: Electron.NativeImage = nativeImage.createEmpty();
    for (const fileName of ['tray-icon.png', 'icon.png']) {
      const candidate = nativeImage.createFromPath(path.join(baseDir, fileName));
      if (!candidate.isEmpty()) {
        icon = candidate;
        break;
      }
    }
    // Dev builds keep icons in assets/; packaged builds flatten extraResource
    // entries into resourcesPath — the loop above already covers both layouts.
    try {
      this.tray = new Tray(icon);
    } catch (err) {
      // GNOME Wayland (and other shells) expose no system tray at all —
      // running trayless beats crashing. Callers check isActive() and keep
      // the window visible instead of hiding into a nonexistent tray.
      console.warn('[tray] System tray unavailable, continuing without it:', err);
      this.tray = null;
      return;
    }
    this.tray.setToolTip('AnimeciX - Indirme devam ediyor');
    this.tray.on('double-click', () => this.showWindow());
    this.rebuildMenu();
  }

  rebuildMenu(): void {
    if (!this.tray) return;
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Goster', click: () => this.showWindow() },
      { type: 'separator' },
      { label: 'Tumunu Duraklat', click: () => this.queue.pauseAll() },
      { label: 'Tumunu Iptal Et', click: () => this.queue.cancelAll() },
      { type: 'separator' },
      {
        label: 'Güncellemeleri kontrol et', // D-18 EXACT STRING
        click: () => { this.updater?.manualCheck(); },
        enabled: this.updater !== null,
      },
      { type: 'separator' },
      { label: 'Cikis', click: () => { markQuitting(); app.quit(); } },
    ]);
    this.tray.setContextMenu(contextMenu);
  }

  showWindow(): void {
    this.mainWindow.show();
    if (this.mainWindow.isMinimized()) this.mainWindow.restore();
    this.mainWindow.focus();
    this.destroyTray();
  }

  destroyTray(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  isActive(): boolean {
    return this.tray !== null && !this.tray.isDestroyed();
  }
}
