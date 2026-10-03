// IPC wiring for push notifications.
//
// Two directions:
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

import { ipcMain, BrowserWindow, Notification } from 'electron';
import type { PushService } from './PushService';
import { PUSH_CHANNELS, type PushNotificationPayload } from './push.types';

export function registerNotificationsIpc(
  push: PushService,
  getWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle(PUSH_CHANNELS.GET_TOKEN, () => push.getToken());

  push.on('token', (token) => {
    sendToRenderer(getWindow(), PUSH_CHANNELS.TOKEN, token);
  });

  push.on('notification', (payload) => {
    showNotification(payload, getWindow);
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
): void {
  if (!Notification.isSupported()) return;

  const notification = new Notification({
    title: payload.title,
    body: payload.body,
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
}

function sendToRenderer(win: BrowserWindow | null, channel: string, payload: unknown): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}
