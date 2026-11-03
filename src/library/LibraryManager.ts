import { BrowserWindow } from 'electron';
import log from 'electron-log';

export class LibraryManager {
  private active = false;
  private mainWindow: BrowserWindow;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    // Back/forward navigation can leave the library without calling hide().
    mainWindow.webContents.on('did-navigate', (_event, url) => {
      this.active = url.startsWith('animecix-library://bundle/');
    });
  }

  show(): void {
    if (this.active) return;
    this.active = true;
    void this.mainWindow.loadURL('animecix-library://bundle/');
    log.info('[library] Navigated mainWindow to library page');
  }

  hide(): void {
    if (!this.active) return;
    this.active = false;
    void this.mainWindow.loadURL(import.meta.env.VITE_SITE_URL);
    log.info('[library] Navigated mainWindow back to website');
  }

  isVisible(): boolean {
    return this.active;
  }

  getMainWindow(): BrowserWindow {
    return this.mainWindow;
  }

  deactivate(): void {
    this.active = false;
  }

  dispose(): void {
    this.active = false;
  }
}
