import { beforeEach, describe, expect, it } from 'vitest';
import {
  findBestQualityMatch,
  loadSavedQuality,
  saveQuality,
  type QualityLike,
} from '../../src/player-page/hooks/useQualityPersistence';

// localStorage is a browser API — stub it for the node test environment
const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
});

const QUALITIES: QualityLike[] = [
  { width: 1280, height: 720, bitrate: 2_500_000 },
  { width: 1920, height: 1080, bitrate: 5_000_000 },
  { width: 2560, height: 1440, bitrate: 9_000_000 },
];

describe('saveQuality / loadSavedQuality', () => {
  it('round-trips a manual quality selection', () => {
    saveQuality({ width: 1920, height: 1080, bitrate: 5_000_000 });
    expect(loadSavedQuality()).toEqual({ width: 1920, height: 1080, bitrate: 5_000_000 });
  });

  it('clears the preference when quality is set back to Auto', () => {
    saveQuality({ width: 1920, height: 1080, bitrate: 5_000_000 });
    saveQuality(null);
    expect(loadSavedQuality()).toBeNull();
  });

  it('returns null for a missing preference', () => {
    expect(loadSavedQuality()).toBeNull();
  });

  it('returns null for corrupt storage content', () => {
    store.set('tau-video-quality', '{not json');
    expect(loadSavedQuality()).toBeNull();
  });

  it('returns null for invalid stored heights', () => {
    store.set('tau-video-quality', JSON.stringify({ width: 0, height: 0, bitrate: 0 }));
    expect(loadSavedQuality()).toBeNull();
  });
});

describe('findBestQualityMatch', () => {
  it('picks the exact quality when available', () => {
    const saved = { width: 1920, height: 1080, bitrate: 5_000_000 };
    const best = findBestQualityMatch(QUALITIES, saved);
    expect(best).toEqual(QUALITIES[1]);
  });

  it('picks the nearest quality when the exact one is unavailable', () => {
    const saved = { width: 3840, height: 2160, bitrate: 16_000_000 };
    const best = findBestQualityMatch(QUALITIES, saved);
    expect(best).toEqual(QUALITIES[2]);
  });

  it('matches by height when bitrate is unknown', () => {
    const saved = { width: 0, height: 720, bitrate: 0 };
    const best = findBestQualityMatch(QUALITIES, saved);
    expect(best).toEqual(QUALITIES[0]);
  });

  it('returns null for an empty quality list', () => {
    const saved = { width: 1920, height: 1080, bitrate: 5_000_000 };
    expect(findBestQualityMatch([], saved)).toBeNull();
  });
});
