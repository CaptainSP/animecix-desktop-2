// IPC channel names and payload contracts for Firebase Cloud Messaging push.
// See: src/notifications/PushService.ts

export const PUSH_CHANNELS = {
  /** Renderer asks for the current FCM token (may be null before registration). */
  GET_TOKEN: 'push:getToken',
  /** Main → renderer: a token became available or was rotated by FCM. */
  TOKEN: 'push:token',
  /** Main → renderer: a push arrived, so the in-app bell can update live. */
  MESSAGE: 'push:message',
} as const;

/**
 * A push message after normalisation, independent of FCM's wire shape.
 *
 * The backend sends the same payload to mobile and desktop: a `notification`
 * block plus `tit`/`bod`/`lin`/`img` inside `data`
 * (see animecix-js services/firebase.ts buildMessage).
 */
export interface PushNotificationPayload {
  title: string;
  body: string;
  /** Absolute, same-origin site URL to open on click. Null when unusable. */
  url: string | null;
  image: string | null;
}
