// PushService — receives Firebase Cloud Messaging pushes inside Electron.
//
// WHY @eneris/push-receiver AND NOT firebase/messaging
// ----------------------------------------------------
// The Firebase JS SDK's web messaging needs a service worker plus a browser
// push service; Electron's Chromium ships without GCM support, so
// PushManager.subscribe() never resolves. push-receiver speaks Google's MCS
// protocol directly from Node: it registers for a real FCM token and holds a
// TLS socket to mtalk.google.com. That means the backend needs no new send
// path — the desktop receives exactly the payloads mobile already gets.
//
// The protocol is reverse engineered, not a published API. Everything here
// fails soft: a missing config, a failed registration or a dropped socket
// disables push and leaves the rest of the app untouched.

import { EventEmitter } from 'node:events';
import PushReceiver from '@eneris/push-receiver';
import type { Credentials } from '@eneris/push-receiver/dist/types';
import type { StorageService } from '../storage/StorageService';
import { normalisePushMessage } from './push-message';
import type { PushNotificationPayload } from './push.types';

/**
 * Registration state from FCM. Losing it means a new token on every launch,
 * which would leave a trail of dead tokens on the backend, so it is persisted
 * across restarts.
 */
const CREDENTIALS_KEY = 'push_credentials';

/**
 * Ids of messages already delivered to us. FCM replays anything it has not
 * seen acknowledged, so without these a restart re-shows every notification
 * from the last few days.
 */
const PERSISTENT_IDS_KEY = 'push_persistent_ids';

/**
 * How many ids to keep. FCM only replays unacknowledged messages from a short
 * window, so an unbounded list would grow forever to prevent replays that can
 * no longer happen.
 */
const MAX_PERSISTENT_IDS = 100;

/**
 * Keeps the MCS socket alive through NAT and router idle timeouts. Google's
 * own clients heartbeat on roughly this interval; longer intervals mean the
 * socket dies silently and pushes stop arriving until the next reconnect.
 */
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Identifies this client to FCM. MUST stay stable across releases: changing it
 * invalidates stored credentials, so every user would get a fresh token and
 * the backend would keep a dead one until it is pruned.
 */
const BUNDLE_ID = 'com.onmuapps.animecix';

interface PushServiceEvents {
  token: (token: string) => void;
  notification: (payload: PushNotificationPayload) => void;
}

export interface PushConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  messagingSenderId: string;
  vapidKey: string;
}

export class PushService extends EventEmitter {
  private receiver: PushReceiver | null = null;
  private started = false;
  private token: string | null = null;

  constructor(
    private storage: StorageService,
    private config: PushConfig,
    private siteUrl: string,
  ) {
    super();
  }

  /**
   * Reads the FCM config from the Vite-injected environment.
   * Returns null when any value is missing — push then stays off instead of
   * registering against a half-configured project.
   */
  static configFromEnv(): PushConfig | null {
    const config: PushConfig = {
      projectId: import.meta.env.VITE_FCM_PROJECT_ID,
      appId: import.meta.env.VITE_FCM_APP_ID,
      apiKey: import.meta.env.VITE_FCM_API_KEY,
      messagingSenderId: import.meta.env.VITE_FCM_SENDER_ID,
      vapidKey: import.meta.env.VITE_FCM_VAPID_KEY,
    };

    const missing = Object.entries(config)
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (missing.length > 0) {
      console.warn(
        `[push] FCM config incomplete (${missing.join(', ')}); push notifications disabled.`,
      );
      return null;
    }

    return config;
  }

  getToken(): string | null {
    return this.token;
  }

  /**
   * Registers with FCM and connects. Resolves to false when push could not be
   * started — never throws, because a push failure must not take the app down.
   */
  async start(): Promise<boolean> {
    if (this.started) return this.receiver !== null;
    this.started = true;

    try {
      this.receiver = new PushReceiver({
        firebase: {
          projectId: this.config.projectId,
          appId: this.config.appId,
          apiKey: this.config.apiKey,
          messagingSenderId: this.config.messagingSenderId,
        },
        vapidKey: this.config.vapidKey,
        bundleId: BUNDLE_ID,
        chromePlatform: chromePlatformFor(process.platform),
        credentials: this.readCredentials() ?? undefined,
        persistentIds: this.readPersistentIds(),
        heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      });

      // Registered before connect(): FCM can rotate credentials during the
      // registration that connect() triggers, and losing that write would mean
      // a fresh token on the next launch.
      this.receiver.onCredentialsChanged(({ newCredentials }) => {
        this.writeCredentials(newCredentials);
        this.publishToken(newCredentials.fcm?.token);
      });

      this.receiver.onNotification((envelope) => {
        this.rememberPersistentIds();

        const payload = normalisePushMessage(envelope.message, this.siteUrl);
        if (payload) {
          this.emit('notification', payload);
        }
      });

      await this.receiver.connect();
      this.publishToken(this.receiver.fcmToken);

      return true;
    } catch (error) {
      // Non-fatal by design: registration needs network and an unofficial
      // Google endpoint. The app runs fine without push.
      console.error('[push] Failed to start push receiver:', error);
      this.receiver = null;
      return false;
    }
  }

  destroy(): void {
    try {
      this.receiver?.destroy();
    } catch {
      /* non-fatal — we are shutting down anyway */
    }
    this.receiver = null;
    this.removeAllListeners();
  }

  private publishToken(token: string | undefined | null): void {
    if (!token || token === this.token) return;
    this.token = token;
    this.emit('token', token);
  }

  private readCredentials(): Credentials | null {
    const raw = this.storage.getSetting(CREDENTIALS_KEY);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as Credentials;
    } catch {
      // Corrupt row: drop it and re-register rather than crashing on launch.
      console.warn('[push] Stored credentials unreadable; re-registering.');
      return null;
    }
  }

  private writeCredentials(credentials: Credentials): void {
    try {
      this.storage.setSetting(CREDENTIALS_KEY, JSON.stringify(credentials));
    } catch (error) {
      console.warn('[push] Could not persist credentials:', error);
    }
  }

  private readPersistentIds(): string[] {
    const raw = this.storage.getSetting(PERSISTENT_IDS_KEY);
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }

  /**
   * push-receiver appends to its own `persistentIds` as messages arrive; this
   * mirrors the tail of that list into SQLite so a restart does not replay it.
   */
  private rememberPersistentIds(): void {
    const ids = this.receiver?.persistentIds ?? [];
    const recent = ids.slice(-MAX_PERSISTENT_IDS);

    try {
      this.storage.setSetting(PERSISTENT_IDS_KEY, JSON.stringify(recent));
    } catch (error) {
      console.warn('[push] Could not persist message ids:', error);
    }
  }

  // Typed event overloads — the base EventEmitter signature is untyped.
  on<K extends keyof PushServiceEvents>(event: K, listener: PushServiceEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  emit<K extends keyof PushServiceEvents>(
    event: K,
    ...args: Parameters<PushServiceEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

/**
 * push-receiver's Chrome platform ids: 1 = Windows, 2 = Darwin, 3 = Linux.
 * Defaults to Linux for anything else, which is what Google's own clients do
 * for unrecognised Unix platforms.
 */
export function chromePlatformFor(platform: NodeJS.Platform): number {
  switch (platform) {
    case 'win32':
      return 1;
    case 'darwin':
      return 2;
    default:
      return 3;
  }
}
