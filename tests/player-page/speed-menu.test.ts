import { describe, it, expect } from 'vitest';
import {
  PLAYBACK_RATES,
  formatSpeedValue,
  getSpeedOptions,
} from '../../src/player-page/components/SpeedMenu';

describe('PLAYBACK_RATES', () => {
  it('offers 0.25 steps all the way to 4x', () => {
    expect(PLAYBACK_RATES[0]).toBe(0.25);
    expect(PLAYBACK_RATES.at(-1)).toBe(4);
    expect(PLAYBACK_RATES).toHaveLength(16);
    for (let i = 1; i < PLAYBACK_RATES.length; i++) {
      expect(PLAYBACK_RATES[i] - PLAYBACK_RATES[i - 1]).toBeCloseTo(0.25);
    }
  });

  it('includes the above-2x speeds an earlier revision dropped', () => {
    expect(PLAYBACK_RATES).toContain(2.5);
    expect(PLAYBACK_RATES).toContain(3);
    expect(PLAYBACK_RATES).toContain(4);
  });
});

describe('getSpeedOptions', () => {
  it('uses a rates array verbatim', () => {
    expect(getSpeedOptions([0.25, 0.5, 1, 1.25, 1.5, 2])).toEqual([0.25, 0.5, 1, 1.25, 1.5, 2]);
  });

  it('expands a { min, max, step } range into a discrete list', () => {
    expect(getSpeedOptions({ min: 0.25, max: 1, step: 0.25 })).toEqual([0.25, 0.5, 0.75, 1]);
  });

  it('expands a range with a fractional step', () => {
    expect(getSpeedOptions({ min: 1, max: 1.5, step: 0.25 })).toEqual([1, 1.25, 1.5]);
  });

  it('handles an empty rates array', () => {
    expect(getSpeedOptions([])).toEqual([]);
  });

  it('falls back to defaults for an empty range config', () => {
    expect(getSpeedOptions({})).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
  });
});

describe('formatSpeedValue', () => {
  it('labels 1x as "Normal"', () => {
    expect(formatSpeedValue(1, 'Normal')).toBe('Normal');
  });

  it('formats other rates as "Nx"', () => {
    expect(formatSpeedValue(0.5, 'Normal')).toBe('0.5x');
    expect(formatSpeedValue(1.5, 'Normal')).toBe('1.5x');
    expect(formatSpeedValue(2, 'Normal')).toBe('2x');
  });

  it('rounds float noise to 2 decimals', () => {
    expect(formatSpeedValue(1.7500000000000002, 'Normal')).toBe('1.75x');
  });
});
