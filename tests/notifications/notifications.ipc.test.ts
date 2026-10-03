import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    /** false = OS bildirimi bastirdi (izin yok / Odak modu). */
    static emitShowOnShow = true;

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
      // macOS gercekten ekrana getirdiginde 'show' tetikleniyor; testler bunu
      // bastirilmis bildirimi taklit etmek icin kapatabiliyor.
      if (Notif.emitShowOnShow) this.listeners.get('show')?.();
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
    dialog: { showMessageBox: vi.fn(() => Promise.resolve({ response: 1 })) },
    shell: { openExternal: vi.fn() },
  };
});

import { ipcMain, dialog, shell } from 'electron';
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

/** SQLite yerine bellekte ayar deposu. */
function createStorageStub(initial: Record<string, string> = {}) {
  const rows = new Map(Object.entries(initial));
  return {
    rows,
    getSetting: (key: string) => rows.get(key) ?? null,
    setSetting: (key: string, value: string) => {
      rows.set(key, value);
    },
  };
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
  FakeNotification.emitShowOnShow = true;
});

describe('registerNotificationsIpc', () => {
  it('answers push:getToken from the service', async () => {
    const push = new FakePush();
    const win = createWindowStub();
    registerNotificationsIpc(push as never, () => win as never, createStorageStub() as never);

    expect(await ipc.__invoke(PUSH_CHANNELS.GET_TOKEN)).toBeNull();

    push.token = 'abc';
    expect(await ipc.__invoke(PUSH_CHANNELS.GET_TOKEN)).toBe('abc');
  });

  it('forwards a new token to the renderer', () => {
    const push = new FakePush();
    const win = createWindowStub();
    registerNotificationsIpc(push as never, () => win as never, createStorageStub() as never);

    push.emit('token', 'fcm-token');

    expect(win.sent).toEqual([{ channel: PUSH_CHANNELS.TOKEN, payload: 'fcm-token' }]);
  });

  it('shows an OS notification and forwards the payload to the renderer', () => {
    const push = new FakePush();
    const win = createWindowStub();
    registerNotificationsIpc(push as never, () => win as never, createStorageStub() as never);

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
    registerNotificationsIpc(push as never, () => win as never, createStorageStub() as never);

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
    registerNotificationsIpc(push as never, () => win as never, createStorageStub() as never);

    push.emit('notification', { ...PAYLOAD, url: null });
    notifications[0].click();

    expect(win.focused).toBe(true);
    expect(win.webContents.loadURL).not.toHaveBeenCalled();
  });

  it('skips the OS notification when the platform does not support it', () => {
    FakeNotification.isSupported.mockReturnValue(false);
    const push = new FakePush();
    const win = createWindowStub();
    registerNotificationsIpc(push as never, () => win as never, createStorageStub() as never);

    push.emit('notification', PAYLOAD);

    expect(notifications).toHaveLength(0);
    // The in-app bell must still update.
    expect(win.sent).toEqual([{ channel: PUSH_CHANNELS.MESSAGE, payload: PAYLOAD }]);
  });

  it('survives a destroyed or missing window', () => {
    const push = new FakePush();
    const win = createWindowStub();
    win.destroyed = true;
    registerNotificationsIpc(push as never, () => win as never, createStorageStub() as never);

    expect(() => push.emit('notification', PAYLOAD)).not.toThrow();
    expect(win.sent).toEqual([]);

    const pushWithoutWindow = new FakePush();
    registerNotificationsIpc(pushWithoutWindow as never, () => null, createStorageStub() as never);
    expect(() => pushWithoutWindow.emit('token', 'x')).not.toThrow();
  });
});

describe('izin uyarisi', () => {
  // `show` olayi bastirilmis bir bildirimi taklit etmek icin kapatiliyor:
  // macOS izin yokken show() sessizce hicbir sey yapiyor, olay da tetiklenmiyor.
  function arrange(storageRows: Record<string, string> = {}) {
    const push = new FakePush();
    const win = createWindowStub();
    const storage = createStorageStub(storageRows);
    registerNotificationsIpc(push as never, () => win as never, storage as never);
    return { push, storage };
  }

  // Platform SABITLENIYOR: uyari yalnizca macOS'ta cikiyor ve CI bu paketi
  // ubuntu + windows runner'larinda da kosuyor. Gercek platforma birakilsaydi
  // bu testler yalnizca bir Mac'te gecerdi.
  const realPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    vi.useFakeTimers();
    (dialog.showMessageBox as ReturnType<typeof vi.fn>).mockClear();
    (dialog.showMessageBox as ReturnType<typeof vi.fn>).mockResolvedValue({ response: 1 });
    (shell.openExternal as ReturnType<typeof vi.fn>).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
  });

  it('bildirim ekrana gelmezse kullaniciyi bir kez uyarir', async () => {
    FakeNotification.emitShowOnShow = false;
    const { push, storage } = arrange();

    push.emit('notification', PAYLOAD);
    await vi.advanceTimersByTimeAsync(6000);

    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect(storage.rows.get('push_permission_hint_shown')).toBe('1');
  });

  it('ikinci bir bastirilmis bildirimde tekrar uyarmaz', async () => {
    FakeNotification.emitShowOnShow = false;
    const { push } = arrange();

    push.emit('notification', PAYLOAD);
    await vi.advanceTimersByTimeAsync(6000);
    push.emit('notification', PAYLOAD);
    await vi.advanceTimersByTimeAsync(6000);

    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('bildirim gosterildiyse uyarmaz ve durumu kaydeder', async () => {
    const { push, storage } = arrange();

    push.emit('notification', PAYLOAD);
    await vi.advanceTimersByTimeAsync(6000);

    expect(storage.rows.get('push_display_confirmed')).toBe('1');
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('daha once bildirim gosterilmisse sessiz kalir', async () => {
    // Odak modu da bildirimi bastirir; bir kez calistigi bilinen bir kurulumda
    // her sessiz bildirim icin uyarmak yanlis olurdu.
    FakeNotification.emitShowOnShow = false;
    const { push } = arrange({ push_display_confirmed: '1' });

    push.emit('notification', PAYLOAD);
    await vi.advanceTimersByTimeAsync(6000);

    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('"Ayarlari Ac" secilirse bildirim ayarlarini acar', async () => {
    FakeNotification.emitShowOnShow = false;
    (dialog.showMessageBox as ReturnType<typeof vi.fn>).mockResolvedValue({ response: 0 });
    const { push } = arrange();

    push.emit('notification', PAYLOAD);
    await vi.advanceTimersByTimeAsync(6000);

    expect(shell.openExternal).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.Notifications-Settings.extension',
    );
  });
});
