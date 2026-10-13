import { describe, it, expect } from 'vitest';
import { isPlausibleOutro } from '../../src/player-page/components/NextCountdown';

describe('isPlausibleOutro', () => {
  it('accepts a normal ending segment', () => {
    expect(isPlausibleOutro(1106, 1205, 1400)).toBe(true);
  });

  it('rejects an outro starting at zero', () => {
    expect(isPlausibleOutro(0, 90, 1400)).toBe(false);
  });

  it('rejects an inverted or empty range', () => {
    expect(isPlausibleOutro(1200, 1100, 1400)).toBe(false);
    expect(isPlausibleOutro(1100, 1100, 1400)).toBe(false);
  });

  it('rejects an outro starting before halftime', () => {
    expect(isPlausibleOutro(400, 500, 1400)).toBe(false);
  });

  it('rejects an outro covering most of the episode', () => {
    expect(isPlausibleOutro(100, 1300, 1400)).toBe(false);
  });

  it('accepts when duration is unknown rather than hiding', () => {
    expect(isPlausibleOutro(1106, 1205, NaN)).toBe(true);
    expect(isPlausibleOutro(1106, 1205, 0)).toBe(true);
  });

  it('rejects non-finite bounds', () => {
    expect(isPlausibleOutro(NaN, 1205, 1400)).toBe(false);
    expect(isPlausibleOutro(1106, Infinity, 1400)).toBe(false);
  });
});
