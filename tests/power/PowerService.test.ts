import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted; the blocker state lives inside the factory and is read
// back through the mocked module below.
vi.mock('electron', () => {
  let nextId = 1;
  const started = new Set<number>();
  return {
    powerSaveBlocker: {
      start: vi.fn((type: string) => {
        if (type !== 'prevent-display-sleep') throw new Error(`unexpected type: ${type}`);
        const id = nextId++;
        started.add(id);
        return id;
      }),
      stop: vi.fn((id: number) => {
        started.delete(id);
      }),
      isStarted: vi.fn((id: number) => started.has(id)),
      /** Test-only: simulate the OS dropping the blocker under us. */
      __forceStop: (id: number) => started.delete(id),
      __startedCount: () => started.size,
      /** The mocked module is shared across the file, so each test clears it. */
      __reset: () => started.clear(),
    },
  };
});

import { powerSaveBlocker } from 'electron';
import { PowerService } from '../../src/power/PowerService';

const blocker = powerSaveBlocker as unknown as {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  __forceStop: (id: number) => void;
  __startedCount: () => number;
  __reset: () => void;
};

describe('PowerService', () => {
  let power: PowerService;

  beforeEach(() => {
    blocker.start.mockClear();
    blocker.stop.mockClear();
    blocker.__reset();
    power = new PowerService();
  });

  it('starts a display-sleep blocker when keep-awake is enabled', () => {
    power.setKeepAwake(true);

    expect(blocker.start).toHaveBeenCalledWith('prevent-display-sleep');
    expect(power.isKeepingAwake()).toBe(true);
  });

  it('does nothing until asked', () => {
    expect(blocker.start).not.toHaveBeenCalled();
    expect(power.isKeepingAwake()).toBe(false);
  });

  it('releases the blocker when keep-awake is disabled', () => {
    power.setKeepAwake(true);
    power.setKeepAwake(false);

    expect(blocker.stop).toHaveBeenCalledTimes(1);
    expect(power.isKeepingAwake()).toBe(false);
    expect(blocker.__startedCount()).toBe(0);
  });

  it('holds a single blocker across repeated enables', () => {
    power.setKeepAwake(true);
    power.setKeepAwake(true);
    power.setKeepAwake(true);

    expect(blocker.start).toHaveBeenCalledTimes(1);
    expect(blocker.__startedCount()).toBe(1);
  });

  it('is a no-op when disabled while nothing is held', () => {
    power.setKeepAwake(false);

    expect(blocker.stop).not.toHaveBeenCalled();
  });

  it('starts a fresh blocker when the previous one was dropped underneath it', () => {
    power.setKeepAwake(true);
    const firstId = blocker.start.mock.results[0].value as number;
    blocker.__forceStop(firstId);

    power.setKeepAwake(true);

    expect(blocker.start).toHaveBeenCalledTimes(2);
    expect(power.isKeepingAwake()).toBe(true);
  });

  it('releases on dispose', () => {
    power.setKeepAwake(true);
    power.dispose();

    expect(power.isKeepingAwake()).toBe(false);
    expect(blocker.__startedCount()).toBe(0);
  });

  it('leaves nothing held after dispose is called twice', () => {
    power.setKeepAwake(true);
    power.dispose();
    power.dispose();

    expect(blocker.stop).toHaveBeenCalledTimes(1);
  });
});
