import { describe, it, expect, vi, beforeEach } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

vi.mock('electron', () => {
  const handlers = new Map<string, Handler>();
  return {
    ipcMain: {
      handle: vi.fn((channel: string, handler: Handler) => {
        if (handlers.has(channel)) throw new Error(`duplicate handler: ${channel}`);
        handlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel);
      }),
      __invoke: (channel: string, ...args: unknown[]) => handlers.get(channel)?.({}, ...args),
      __has: (channel: string) => handlers.has(channel),
    },
    BrowserWindow: class {},
  };
});

import { ipcMain } from 'electron';
import { registerPowerIpc } from '../../src/power/power.ipc';

const ipc = ipcMain as unknown as {
  __invoke: (channel: string, ...args: unknown[]) => unknown;
  __has: (channel: string) => boolean;
  removeHandler: (channel: string) => void;
};

/** Minimal BrowserWindow stand-in that lets tests fire lifecycle events. */
function createWindowStub() {
  const webContentsListeners = new Map<string, () => void>();
  const windowListeners = new Map<string, () => void>();
  return {
    webContents: {
      on: (event: string, listener: () => void) => {
        webContentsListeners.set(event, listener);
      },
    },
    on: (event: string, listener: () => void) => {
      windowListeners.set(event, listener);
    },
    emitWebContents: (event: string) => webContentsListeners.get(event)?.(),
    emit: (event: string) => windowListeners.get(event)?.(),
    hasWebContentsListener: (event: string) => webContentsListeners.has(event),
  };
}

describe('registerPowerIpc', () => {
  let power: { setKeepAwake: ReturnType<typeof vi.fn> };
  let win: ReturnType<typeof createWindowStub>;

  beforeEach(() => {
    power = { setKeepAwake: vi.fn() };
    win = createWindowStub();
    ipc.removeHandler('power:setKeepAwake');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerPowerIpc(power as any, win as any);
  });

  it('registers the power:setKeepAwake channel', () => {
    expect(ipc.__has('power:setKeepAwake')).toBe(true);
  });

  it('forwards true to the service', () => {
    ipc.__invoke('power:setKeepAwake', true);
    expect(power.setKeepAwake).toHaveBeenCalledWith(true);
  });

  it('forwards false to the service', () => {
    ipc.__invoke('power:setKeepAwake', false);
    expect(power.setKeepAwake).toHaveBeenCalledWith(false);
  });

  it('coerces a non-boolean payload rather than passing it through', () => {
    ipc.__invoke('power:setKeepAwake', undefined);
    ipc.__invoke('power:setKeepAwake', 'yes');

    expect(power.setKeepAwake).toHaveBeenNthCalledWith(1, false);
    expect(power.setKeepAwake).toHaveBeenNthCalledWith(2, true);
  });

  it('can be registered twice without throwing (macOS window re-create)', () => {
    const second = createWindowStub();
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerPowerIpc(power as any, second as any),
    ).not.toThrow();
  });

  it('releases the blocker on a committed main-frame navigation', () => {
    win.emitWebContents('did-navigate');
    expect(power.setKeepAwake).toHaveBeenCalledWith(false);
  });

  it('releases the blocker when the renderer dies', () => {
    win.emitWebContents('render-process-gone');
    expect(power.setKeepAwake).toHaveBeenCalledWith(false);
  });

  it('releases the blocker when the window is closed', () => {
    win.emit('closed');
    expect(power.setKeepAwake).toHaveBeenCalledWith(false);
  });
});
