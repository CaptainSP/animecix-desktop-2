import { ipcMain, BrowserWindow } from 'electron';
import type { PowerService } from './PowerService';

/**
 * Register the keep-awake IPC handler.
 *
 * power:setKeepAwake — called by animecix.tv when the player iframe reports
 * play/pause/ended (the iframe cannot reach ipcMain itself), and called directly
 * by the player page during offline playback, where it is the top-level document
 * and so has the preload bridge.
 *
 * Nothing in the renderer is guaranteed to send the matching `false`: a reload, a
 * crash, or navigating away all drop the state that asked for the blocker, so the
 * window's own lifecycle releases it as well. Whoever still wants the screen
 * awake asks again on the next play event.
 */
export function registerPowerIpc(power: PowerService, win: BrowserWindow): void {
  // The macOS 'activate' path recreates the window and re-runs IPC registration,
  // and ipcMain.handle() throws on a duplicate channel. Dropping the previous
  // handler first keeps that path from taking the app down.
  ipcMain.removeHandler('power:setKeepAwake');

  ipcMain.handle('power:setKeepAwake', (_event, enabled: boolean) => {
    // Boolean() coercion is defense-in-depth, as with window:setFullscreen
    // (D-09): contextBridge can serialize an unexpected value to null/undefined.
    power.setKeepAwake(Boolean(enabled));
  });

  // A committed main-frame navigation means the document that asked for the
  // blocker is gone. Angular's own routing is same-document and does not reach
  // here, so this fires on reloads and on the library's navigation to the
  // offline player — both of which re-assert keep-awake when playback starts.
  win.webContents.on('did-navigate', () => {
    power.setKeepAwake(false);
  });

  // The renderer cannot send a release once it is gone.
  win.webContents.on('render-process-gone', () => {
    power.setKeepAwake(false);
  });

  win.on('closed', () => {
    power.setKeepAwake(false);
  });
}
