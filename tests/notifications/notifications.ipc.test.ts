import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

// Declared via vi.hoisted: the vi.mock factory below runs before the module
// body, so a plain top-level class would not exist yet.
const { FakeNotification, notifications } = vi.hoisted(() => {
  const created: InstanceType<typeof Notif>[] = [];

  class Notif {
    shown = false;
    options: { title: string; body: string };
    private listeners = new Map<string, () => void>();

    static isSupported = vi.fn(() => true);

    constructor(options: { title: string; body: string }) {
      this.options = options;
      created.push(this);
    }

    on(event: string, listener: () => void) {
      this.listeners.set(event, listener);
      return this;
    }

    show() {
      this.shown = true;
    }

    click() {
      this.listeners.get('click')?.();
    }
  }

  return { FakeNotification: Notif, notifications: created };
});

vi.mock('electron', () => {
  const handlers = new Map<string, Handler>();
  return {
    ipcMain: {
      handle: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      }),
      __invoke: (channel: string, ...args: unknown[]) => handlers.get(channel)?.({}, ...args),
    },
    BrowserWindow: class {},
    Notification: FakeNotification,
  };
});

import { ipcMain } from 'electron';
import { registerNotificationsIpc } from '../../src/notifications/notifications.ipc';
import { PUSH_CHANNELS, type PushNotificationPayload as PushNotification } from '../../src/notifications/push.types';

const ipc = ipcMain as unknown as {
  __invoke: (channel: string, ...args: unknown[]) => unknown;
};

/** Stands in for PushService — only the event surface the IPC layer uses. */
class FakePush extends EventEmitter {
  token: string | null = null;
  getToken() {
    return this.token;
  }
}

function createWindowStub() {
  const sent: { channel: string; payload: unknown }[] = [];
  return {
    sent,
    destroyed: false,
    minimized: false,
    visible: true,
    focused: false,
    restored: false,
    loadedUrl: null as string | null,
    isDestroyed() {
      return this.destroyed;
    },
    isMinimized() {
      return this.minimized;
    },
    isVisible() {
      return this.visible;
    },
    restore() {
      this.restored = true;
      this.minimized = false;
    },
    show() {
      this.visible = true;
    },
    focus() {
      this.focused = true;
    },
    webContents: {
      send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
      loadURL: vi.fn(async (url: string) => {
        (this as unknown as { loadedUrl: string }).loadedUrl = url;
      }),
    },
  };
}

const PAYLOAD: PushNotification = {
  title: 'Bölüm eklendi',
  body: 'Görüntülemek için tıklayın.',
  url: 'https://animecix.tv/titles/7',
  image: null,
};

beforeEach(() => {
  notifications.length = 0;
  FakeNotification.isSupported.mockReturnValue(true);
});

describe('registerNotificationsIpc', () => {
  it('answers push:getToken from the service', async () => {
    const push = new FakePush();
    const win = createWindowStub();
    registerNotificationsIpc(push as never, () => win as never);

    expect(await ipc.__invoke(PUSH_CHANNELS.GET_TOKEN)).toBeNull();

    push.token = 'abc';
    expect(await ipc.__invoke(PUSH_CHANNELS.GET_TOKEN)).toBe('abc');
  });

  it('forwards a new token to the renderer', () => {
    const push = new FakePush();
    const win = createWindowStub();
    registerNotificationsIpc(push as never, () => win as never);

    push.emit('token', 'fcm-token');

    expect(win.sent).toEqual([{ channel: PUSH_CHANNELS.TOKEN, payload: 'fcm-token' }]);
  });

  it('shows an OS notification and forwards the payload to the renderer', () => {
    const push = new FakePush();
    const win = createWindowStub();
    registerNotificationsIpc(push as never, () => win as never);

    push.emit('notification', PAYLOAD);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].options).toEqual({ title: PAYLOAD.title, body: PAYLOAD.body });
    expect(notifications[0].shown).toBe(true);
    expect(win.sent).toEqual([{ channel: PUSH_CHANNELS.MESSAGE, payload: PAYLOAD }]);
  });

  it('restores, focuses and navigates the window on click', () => {
    const push = new FakePush();
    const win = createWindowStub();
    win.minimized = true;
    win.visible = false;
    registerNotificationsIpc(push as never, () => win as never);

    push.emit('notification', PAYLOAD);
    notifications[0].click();

    expect(win.restored).toBe(true);
    expect(win.visible).toBe(true);
    expect(win.focused).toBe(true);
    expect(win.webContents.loadURL).toHaveBeenCalledWith(PAYLOAD.url);
  });

  it('does not navigate when the push carried no usable link', () => {
    const push = new FakePush();
    const win = createWindowStub();
    registerNotificationsIpc(push as never, () => win as never);

    push.emit('notification', { ...PAYLOAD, url: null });
    notifications[0].click();

    expect(win.focused).toBe(true);
    expect(win.webContents.loadURL).not.toHaveBeenCalled();
  });

  it('skips the OS notification when the platform does not support it', () => {
    FakeNotification.isSupported.mockReturnValue(false);
    const push = new FakePush();
    const win = createWindowStub();
    registerNotificationsIpc(push as never, () => win as never);

    push.emit('notification', PAYLOAD);

    expect(notifications).toHaveLength(0);
    // The in-app bell must still update.
    expect(win.sent).toEqual([{ channel: PUSH_CHANNELS.MESSAGE, payload: PAYLOAD }]);
  });

  it('survives a destroyed or missing window', () => {
    const push = new FakePush();
    const win = createWindowStub();
    win.destroyed = true;
    registerNotificationsIpc(push as never, () => win as never);

    expect(() => push.emit('notification', PAYLOAD)).not.toThrow();
    expect(win.sent).toEqual([]);

    const pushWithoutWindow = new FakePush();
    registerNotificationsIpc(pushWithoutWindow as never, () => null);
    expect(() => pushWithoutWindow.emit('token', 'x')).not.toThrow();
  });
});
