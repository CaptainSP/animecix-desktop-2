// Detects the one failure mode the user cannot diagnose: the OS silently
// dropping every notification because the app was never granted permission.
//
// WHY A HEURISTIC AND NOT AN API
// ------------------------------
// Electron exposes no way to read macOS notification authorisation.
// `Notification.isSupported()` reports platform capability, not permission —
// it returns true on a Mac where the user has notifications switched off for
// this app. `new Notification().show()` on a denied app resolves without an
// error and emits no event at all, so from the app's side a suppressed
// notification and a delivered one look identical.
//
// The one signal that does exist is the `show` event: macOS emits it only when
// the notification actually reached the screen. So "we pushed a notification
// and `show` never fired" is the closest thing to a permission check there is.
//
// Kept free of Electron imports so the decision is unit testable
// (tests/notifications/notification-permission.test.ts).

/** macOS Ventura and later. Opens System Settings straight at Notifications. */
export const MACOS_NOTIFICATION_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.Notifications-Settings.extension';

/**
 * How long to wait for the `show` event before assuming the notification was
 * suppressed. Generous on purpose: a false "notifications are off" dialog in
 * front of a user whose notifications work is worse than telling them late.
 */
export const DISPLAY_CONFIRMATION_GRACE_MS = 5000;

/** SQLite settings keys. Both survive restarts — the hint must not repeat. */
export const DISPLAY_CONFIRMED_KEY = 'push_display_confirmed';
export const PERMISSION_HINT_SHOWN_KEY = 'push_permission_hint_shown';

export interface PermissionHintState {
  platform: NodeJS.Platform;
  /** A notification has been seen on screen at least once, ever. */
  displayConfirmed: boolean;
  /** The user has already been told once. */
  hintShown: boolean;
}

/**
 * Whether to tell the user their notifications are switched off.
 *
 * Shown AT MOST ONCE, and never again after any notification is confirmed
 * displayed. That ordering matters: a user with Do Not Disturb on for an
 * afternoon also produces an unconfirmed display, and nagging them every time
 * would be worse than the problem. One dialog they can act on is enough; if
 * they fix it, the confirmation flag makes the question permanently moot.
 *
 * macOS only. Windows suppression is Focus Assist rather than a per-app
 * permission, and the remedy differs — pointing a Windows user at macOS
 * settings would be worse than saying nothing.
 */
export function shouldPromptForPermission(state: PermissionHintState): boolean {
  if (state.platform !== 'darwin') return false;
  if (state.displayConfirmed) return false;
  return !state.hintShown;
}
