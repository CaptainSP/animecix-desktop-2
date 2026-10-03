import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Credentials } from '@eneris/push-receiver/dist/types';

/**
 * Fake PushReceiver. The real one opens a TLS socket to mtalk.google.com on
 * connect(), so the suite would need network and a real Firebase project.
 * This records the config it was constructed with and lets tests fire the
 * callbacks push-receiver would fire.
 *
 * Declared via vi.hoisted because vi.mock factories run before the module
 * body, so a plain top-level class would not exist yet.
 */
const { FakeReceiver, receivers } = vi.hoisted(() => {
  const created: InstanceType<typeof Receiver>[] = [];

  class Receiver {
    persistentIds: string[] = [];
    fcmToken = 'token-from-connect';
    connectCalls = 0;
    destroyCalls = 0;
    config: Record<string, unknown>;
    private messageListeners: ((envelope: {
      message: unknown;
      persistentId: string;
    }) => void)[] = [];
    private credentialsListeners: ((data: { newCredentials: unknown }) => void)[] = [];
    /** Set by tests to make connect() reject, as a failed registration would. */
    static failConnect = false;

    constructor(config: Record<string, unknown>) {
      this.config = config;
      created.push(this);
    }

    onNotification(
      listener: (envelope: { message: unknown; persistentId: string }) => void,
    ): () => void {
      this.messageListeners.push(listener);
      return (): void => undefined;
    }

    onCredentialsChanged(listener: (data: { newCredentials: unknown }) => void): () => void {
      this.credentialsListeners.push(listener);
      return (): void => undefined;
    }

    connect = async () => {
      this.connectCalls++;
      if (Receiver.failConnect) throw new Error('registration failed');
    };

    destroy = () => {
      this.destroyCalls++;
    };

    emitMessage(message: unknown, persistentId: string) {
      this.persistentIds.push(persistentId);
      this.messageListeners.forEach((l) => l({ message, persistentId }));
    }

    emitCredentials(credentials: unknown) {
      this.credentialsListeners.forEach((l) => l({ newCredentials: credentials }));
    }
  }

  return { FakeReceiver: Receiver, receivers: created };
});

vi.mock('@eneris/push-receiver', () => ({ default: FakeReceiver }));

import { PushService, chromePlatformFor } from '../../src/notifications/PushService';

const SITE = 'https://animecix.tv';

const CONFIG = {
  projectId: 'animecix-test',
  appId: '1:1:web:1',
  apiKey: 'key',
  messagingSenderId: '1',
  vapidKey: 'vapid',
};

function createStorageStub(initial: Record<string, string> = {}) {
  const rows = new Map(Object.entries(initial));
  return {
    rows,
    getSetting: vi.fn((key: string) => rows.get(key) ?? null),
    setSetting: vi.fn((key: string, value: string) => {
      rows.set(key, value);
    }),
  };
}

function credentialsWithToken(token: string): Credentials {
  return { fcm: { token } } as unknown as Credentials;
}

beforeEach(() => {
  receivers.length = 0;
  FakeReceiver.failConnect = false;
});

describe('PushService.start', () => {
  it('passes stored credentials and message ids to the receiver', async () => {
    const stored = credentialsWithToken('stored-token');
    const storage = createStorageStub({
      push_credentials: JSON.stringify(stored),
      push_persistent_ids: JSON.stringify(['a', 'b']),
    });

    const push = new PushService(storage as never, CONFIG, SITE);
    await expect(push.start()).resolves.toBe(true);

    expect(receivers).toHaveLength(1);
    expect(receivers[0].config.credentials).toEqual(stored);
    expect(receivers[0].config.persistentIds).toEqual(['a', 'b']);
    expect(receivers[0].connectCalls).toBe(1);
  });

  it('is idempotent — a second start does not open a second receiver', async () => {
    const push = new PushService(createStorageStub() as never, CONFIG, SITE);
    await push.start();
    await push.start();
    expect(receivers).toHaveLength(1);
  });

  it('ignores corrupt stored credentials instead of throwing', async () => {
    const storage = createStorageStub({ push_credentials: '{not json' });
    const push = new PushService(storage as never, CONFIG, SITE);

    await expect(push.start()).resolves.toBe(true);
    expect(receivers[0].config.credentials).toBeUndefined();
  });

  it('reports failure without throwing when registration fails', async () => {
    FakeReceiver.failConnect = true;
    const push = new PushService(createStorageStub() as never, CONFIG, SITE);

    await expect(push.start()).resolves.toBe(false);
    expect(push.getToken()).toBeNull();
  });

  it('exposes the token from connect and emits it once', async () => {
    const push = new PushService(createStorageStub() as never, CONFIG, SITE);
    const seen: string[] = [];
    push.on('token', (token) => seen.push(token));

    await push.start();

    expect(push.getToken()).toBe('token-from-connect');
    expect(seen).toEqual(['token-from-connect']);
  });
});

describe('PushService credentials persistence', () => {
  it('persists rotated credentials and emits the new token', async () => {
    const storage = createStorageStub();
    const push = new PushService(storage as never, CONFIG, SITE);
    const seen: string[] = [];
    push.on('token', (token) => seen.push(token));

    await push.start();
    receivers[0].emitCredentials(credentialsWithToken('rotated-token'));

    expect(JSON.parse(storage.rows.get('push_credentials') as string)).toEqual(
      credentialsWithToken('rotated-token'),
    );
    expect(seen).toEqual(['token-from-connect', 'rotated-token']);
  });

  it('does not re-emit an unchanged token', async () => {
    const push = new PushService(createStorageStub() as never, CONFIG, SITE);
    const seen: string[] = [];
    push.on('token', (token) => seen.push(token));

    await push.start();
    receivers[0].emitCredentials(credentialsWithToken('token-from-connect'));

    expect(seen).toEqual(['token-from-connect']);
  });
});

describe('PushService message handling', () => {
  it('emits a normalised notification and records the message id', async () => {
    const storage = createStorageStub();
    const push = new PushService(storage as never, CONFIG, SITE);
    const seen: unknown[] = [];
    push.on('notification', (payload) => seen.push(payload));

    await push.start();
    receivers[0].emitMessage(
      {
        notification: { title: 'Başlık', body: 'Gövde' },
        data: { lin: 'https://animecix.net/titles/7' },
      },
      'msg-1',
    );

    expect(seen).toEqual([
      {
        title: 'Başlık',
        body: 'Gövde',
        url: 'https://animecix.tv/titles/7',
        image: null,
      },
    ]);
    expect(JSON.parse(storage.rows.get('push_persistent_ids') as string)).toEqual(['msg-1']);
  });

  it('records the id even for a message with nothing to show', async () => {
    // Otherwise an empty push would be replayed by FCM on every restart.
    const storage = createStorageStub();
    const push = new PushService(storage as never, CONFIG, SITE);
    const seen: unknown[] = [];
    push.on('notification', (payload) => seen.push(payload));

    await push.start();
    receivers[0].emitMessage({ data: {} }, 'msg-empty');

    expect(seen).toEqual([]);
    expect(JSON.parse(storage.rows.get('push_persistent_ids') as string)).toEqual(['msg-empty']);
  });

  it('keeps at most 100 message ids', async () => {
    const storage = createStorageStub();
    const push = new PushService(storage as never, CONFIG, SITE);
    await push.start();

    for (let i = 0; i < 150; i++) {
      receivers[0].emitMessage({ data: { tit: `n${i}` } }, `msg-${i}`);
    }

    const ids = JSON.parse(storage.rows.get('push_persistent_ids') as string) as string[];
    expect(ids).toHaveLength(100);
    expect(ids[0]).toBe('msg-50');
    expect(ids[99]).toBe('msg-149');
  });
});

describe('PushService.destroy', () => {
  it('destroys the receiver and drops listeners', async () => {
    const push = new PushService(createStorageStub() as never, CONFIG, SITE);
    const seen: unknown[] = [];
    push.on('notification', (payload) => seen.push(payload));

    await push.start();
    const receiver = receivers[0];
    push.destroy();

    expect(receiver.destroyCalls).toBe(1);
    // Listeners are gone, so a late message cannot reach the app.
    receiver.emitMessage({ data: { tit: 'late' } }, 'msg-late');
    expect(seen).toEqual([]);
  });
});

describe('PushService.configFromEnv', () => {
  it('returns every field populated when the env is complete', () => {
    // Asserts shape, not values: vitest.config.ts injects placeholders, but a
    // real VITE_FCM_* in .env or in CI secrets takes precedence over them, so
    // pinning the literals here would make the suite depend on which machine
    // it runs on.
    const config = PushService.configFromEnv();

    expect(config).not.toBeNull();
    expect(Object.keys(config).sort()).toEqual([
      'apiKey',
      'appId',
      'messagingSenderId',
      'projectId',
      'vapidKey',
    ]);
    Object.values(config).forEach(value => {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    });
  });

  it('returns null when a value is missing', () => {
    vi.stubEnv('VITE_FCM_VAPID_KEY', '');
    expect(PushService.configFromEnv()).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe('chromePlatformFor', () => {
  it('maps platforms to push-receiver ids', () => {
    expect(chromePlatformFor('win32')).toBe(1);
    expect(chromePlatformFor('darwin')).toBe(2);
    expect(chromePlatformFor('linux')).toBe(3);
    expect(chromePlatformFor('freebsd')).toBe(3);
  });
});
