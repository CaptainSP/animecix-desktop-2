import { describe, it, expect } from 'vitest';
import { usesNativeFrame } from '../../src/window/window-frame';

describe('usesNativeFrame', () => {
  it('is true on Linux, where Window Controls Overlay is unreliable', () => {
    expect(usesNativeFrame('linux')).toBe(true);
  });

  it('is false on macOS and Windows, which keep the frameless window', () => {
    expect(usesNativeFrame('darwin')).toBe(false);
    expect(usesNativeFrame('win32')).toBe(false);
  });
});
