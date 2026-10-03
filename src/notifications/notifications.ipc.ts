// IPC wiring for push notifications.
//
// Three directions:
//   main → OS    : a native notification per push, click navigates the window
//   main → render: the same payload, so animecix.tv's bell updates live
//   render → main: push:getToken, so the website can register the token with
//                  animecix-js using its own authenticated session
//
// Why the website registers the token and not the main process: the FCM token
// has to be stored against a logged-in user, and the session cookie lives in
// the renderer. Re-implementing auth in the main process would duplicate the
// one thing the website already does well — this mirrors the existing bridge
// pattern (see CLAUDE.md "IPC Communication Pattern").

import { ipcMain, BrowserWindow, Notification, dialog, shell } from 'electron';
import type { PushService } from './PushService';
import type { StorageService } from '../storage/StorageService';
import { PUSH_CHANNELS, type PushNotificationPayload } from './push.types';
import {
  DISPLAY_CONFIRMATION_GRACE_MS,
  DISPLAY_CONFIRMED_KEY,
  MACOS_NOTIFICATION_SETTINGS_URL,
  PERMISSION_HINT_SHOWN_KEY,
  shouldPromptForPermission,
} from './notification-permission';

export function registerNotificationsIpc(
  push: PushService,
  getWindow: () => BrowserWindow | null,
  storage: StorageService,
): void {
  ipcMain.handle(PUSH_CHANNELS.GET_TOKEN, () => push.getToken());

  push.on('token', (token) => {
    sendToRenderer(getWindow(), PUSH_CHANNELS.TOKEN, token);
  });

  push.on('notification', (payload) => {
    showNotification(payload, getWindow, storage);
    sendToRenderer(getWindow(), PUSH_CHANNELS.MESSAGE, payload);
  });
}

/**
 * Shows the OS notification and wires its click to in-app navigation.
 *
 * `loadURL` rather than a router message to the renderer: it is the same
 * mechanism the Google-login deep link already uses (src/auth/deep-link.ts)
 * and it cannot silently do nothing if the website bundle is older than this
 * desktop release. The URL was already restricted to the site's own origin in
 * normalisePushMessage — nothing untrusted reaches loadURL here.
 */
function showNotification(
  payload: PushNotificationPayload,
  getWindow: () => BrowserWindow | null,
  storage: StorageService,
): void {
  if (!Notification.isSupported()) {
    console.warn('[push] OS notifications unsupported; in-app bell only.');
    return;
  }

  const notification = new Notification({
    title: payload.title,
    body: payload.body,
  });

  let displayed = false;

  // The only evidence the notification actually reached the screen.
  notification.on('show', () => {
    displayed = true;
    rememberDisplayConfirmed(storage);
  });

  notification.on('click', () => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;

    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();

    if (payload.url) {
      void win.webContents.loadURL(payload.url);
    }
  });

  notification.show();

  // No `show` within the grace period means the OS swallowed it — on macOS
  // almost always because the app has no notification permission. Nothing is
  // thrown and no event fires, so without this timer the failure is completely
  // invisible to both the user and the app.
  setTimeout(() => {
    if (displayed) return;
    maybeWarnAboutPermission(storage);
  }, DISPLAY_CONFIRMATION_GRACE_MS);
}

function rememberDisplayConfirmed(storage: StorageService): void {
  try {
    if (storage.getSetting(DISPLAY_CONFIRMED_KEY) === '1') return;
    storage.setSetting(DISPLAY_CONFIRMED_KEY, '1');
  } catch {
    /* non-fatal — worst case the hint is evaluated again next time */
  }
}

/**
 * Tells the user once that notifications are switched off, and offers to open
 * the settings pane. Never throws: this is a courtesy path and must not take
 * down push handling.
 */
function maybeWarnAboutPermission(storage: StorageService): void {
  try {
    const shouldPrompt = shouldPromptForPermission({
      platform: process.platform,
      displayConfirmed: storage.getSetting(DISPLAY_CONFIRMED_KEY) === '1',
      hintShown: storage.getSetting(PERMISSION_HINT_SHOWN_KEY) === '1',
    });

    if (!shouldPrompt) return;

    // Written before the dialog, not after: if the user quits with the dialog
    // open we still must not ask again on every single push.
    storage.setSetting(PERMISSION_HINT_SHOWN_KEY, '1');

    void dialog
      .showMessageBox({
        type: 'info',
        title: 'Bildirimler kapalı',
        message: 'AnimeciX bildirim gösteremiyor',
        detail:
          'Yeni bölüm ve mesaj bildirimlerini görebilmen için macOS ayarlarından ' +
          'AnimeciX’e bildirim izni vermen gerekiyor.\n\n' +
          'Sistem Ayarları → Bildirimler → AnimeciX → “Bildirimlere izin ver”.',
        buttons: ['Ayarları Aç', 'Daha Sonra'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          void shell.openExternal(MACOS_NOTIFICATION_SETTINGS_URL);
        }
      })
      .catch(() => {
        /* non-fatal */
      });
  } catch (error) {
    console.warn('[push] permission hint failed:', error);
  }
}

function sendToRenderer(win: BrowserWindow | null, channel: string, payload: unknown): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}
