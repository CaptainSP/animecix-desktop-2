import { describe, it, expect } from 'vitest';
import {
  camelToKebabCase,
  hexToRgb,
  percentToRatio,
  fontFamilyCSSVarValue,
  textShadowCSSVarValue,
  FONT_DEFAULTS,
} from '../../src/player-page/components/CaptionStylesMenu';

describe('camelToKebabCase', () => {
  it('converts camelCase to kebab-case', () => {
    expect(camelToKebabCase('textBgOpacity')).toBe('text-bg-opacity');
    expect(camelToKebabCase('fontFamily')).toBe('font-family');
    expect(camelToKebabCase('displayBg')).toBe('display-bg');
  });

  it('leaves already-kebab values untouched', () => {
    expect(camelToKebabCase('text-color')).toBe('text-color');
  });
});

describe('hexToRgb', () => {
  it('converts hex colors to an "r g b" triple', () => {
    expect(hexToRgb('#ffffff')).toBe('255 255 255');
    expect(hexToRgb('#000000')).toBe('0 0 0');
  });
});

describe('percentToRatio', () => {
  it('converts percentages to ratios', () => {
    expect(percentToRatio('100%')).toBe('1');
    expect(percentToRatio('50%')).toBe('0.5');
    expect(percentToRatio('0%')).toBe('0');
  });
});

describe('fontFamilyCSSVarValue', () => {
  it('maps each family key to its CSS font stack', () => {
    expect(fontFamilyCSSVarValue('mono-serif')).toContain('Courier New');
    expect(fontFamilyCSSVarValue('pro-sans')).toContain('Roboto');
    expect(fontFamilyCSSVarValue('capitals')).toContain('Marcellus SC');
  });

  it('falls back to a serif stack for unknown keys', () => {
    expect(fontFamilyCSSVarValue('unknown')).toContain('Times New Roman');
  });
});

describe('textShadowCSSVarValue', () => {
  it('returns a shadow stack for each style', () => {
    expect(textShadowCSSVarValue('drop shadow')).toContain('rgb(34, 34, 34)');
    expect(textShadowCSSVarValue('outline')).toContain('0px 0px 1.86389px');
  });

  it('returns an empty string for "none" or unknown values', () => {
    expect(textShadowCSSVarValue('none')).toBe('');
    expect(textShadowCSSVarValue('weird')).toBe('');
  });
});

describe('FONT_DEFAULTS', () => {
  it('seeds every font setting with a default value', () => {
    expect(FONT_DEFAULTS).toEqual({
      fontFamily: 'pro-sans',
      fontSize: '100%',
      textColor: '#ffffff',
      textOpacity: '100%',
      textShadow: 'none',
      textBg: '#000000',
      textBgOpacity: '100%',
      displayBg: '#000000',
      displayBgOpacity: '0%',
    });
  });
});
