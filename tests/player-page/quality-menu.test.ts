import { describe, it, expect } from 'vitest';
import {
  buildQualityOptions,
  resolveQualityValue,
  findQualityIndex,
} from '../../src/player-page/components/QualityMenu';

interface TestQuality {
  height?: number;
}

const qualities: TestQuality[] = [
  { height: 480 },
  { height: 1080 },
  { height: 720 },
];

describe('buildQualityOptions', () => {
  it('puts "Otomatik" first, then sorts qualities highest → lowest', () => {
    const options = buildQualityOptions(qualities, 'Otomatik');
    expect(options).toEqual([
      { label: 'Otomatik', value: 'auto' },
      { label: '1080p', value: '1080' },
      { label: '720p', value: '720' },
      { label: '480p', value: '480' },
    ]);
  });

  it('filters out qualities without a height', () => {
    const options = buildQualityOptions([...qualities, { height: undefined }], 'Otomatik');
    expect(options).toHaveLength(4);
  });

  it('handles an empty quality list', () => {
    const options = buildQualityOptions([], 'Otomatik');
    expect(options).toEqual([{ label: 'Otomatik', value: 'auto' }]);
  });
});

describe('resolveQualityValue', () => {
  it('returns "auto" when auto quality is enabled', () => {
    expect(resolveQualityValue(true, { height: 720 })).toBe('auto');
  });

  it('returns the height of the selected quality when auto is off', () => {
    expect(resolveQualityValue(false, { height: 1080 })).toBe('1080');
  });

  it('returns "auto" when no quality is selected or height is unknown', () => {
    expect(resolveQualityValue(false, null)).toBe('auto');
    expect(resolveQualityValue(false, { height: undefined })).toBe('auto');
  });
});

describe('findQualityIndex', () => {
  it('finds the provider-list index matching the selected height', () => {
    expect(findQualityIndex(qualities, '1080')).toBe(1);
    expect(findQualityIndex(qualities, '720')).toBe(2);
  });

  it('returns -1 when no quality matches', () => {
    expect(findQualityIndex(qualities, '2160')).toBe(-1);
  });
});
