import { describe, it, expect } from 'vitest';
import {
  OFFLINE_NETWORK_ERROR_CODES,
  ABORTED_ERROR_CODE,
  shouldOpenLibraryOnLoadFailure,
  type LoadFailureContext,
} from '../../src/library/offline-fallback';

function ctx(overrides: Partial<LoadFailureContext> = {}): LoadFailureContext {
  return {
    errorCode: -105, // ERR_NAME_NOT_RESOLVED
    isMainFrame: true,
    validatedURL: 'https://animecix.tv',
    devSiteURL: 'http://localhost:4200',
    isPackaged: true,
    libraryVisible: false,
    ...overrides,
  };
}

describe('shouldOpenLibraryOnLoadFailure', () => {
  it('opens library on a network error for the main frame', () => {
    expect(shouldOpenLibraryOnLoadFailure(ctx())).toBe(true);
  });

  it('ignores subframe failures (ads, iframes, CDN)', () => {
    expect(shouldOpenLibraryOnLoadFailure(ctx({ isMainFrame: false }))).toBe(false);
  });

  it('does not reopen the library when it is already visible', () => {
    expect(shouldOpenLibraryOnLoadFailure(ctx({ libraryVisible: true }))).toBe(false);
    expect(
      shouldOpenLibraryOnLoadFailure(ctx({ errorCode: -106, libraryVisible: true })),
    ).toBe(false);
  });

  it('ignores ERR_ABORTED (navigation superseded by a newer load)', () => {
    expect(shouldOpenLibraryOnLoadFailure(ctx({ errorCode: ABORTED_ERROR_CODE }))).toBe(false);
  });

  it('ignores non-network errors (e.g. HTTP failures, cert errors)', () => {
    expect(shouldOpenLibraryOnLoadFailure(ctx({ errorCode: -2 }))).toBe(false);
    expect(shouldOpenLibraryOnLoadFailure(ctx({ errorCode: -200 }))).toBe(false);
  });

  it('recognizes all documented network error codes', () => {
    for (const code of OFFLINE_NETWORK_ERROR_CODES) {
      expect(shouldOpenLibraryOnLoadFailure(ctx({ errorCode: code }))).toBe(true);
    }
  });

  it('lets the dev fallback handle localhost failures (site retry happens first)', () => {
    const devCtx = ctx({ isPackaged: false, validatedURL: 'http://localhost:4200' });
    expect(shouldOpenLibraryOnLoadFailure(devCtx)).toBe(false);
  });

  it('still opens the library in dev when the real site fails', () => {
    const devCtx = ctx({ isPackaged: false, validatedURL: 'https://animecix.tv' });
    expect(shouldOpenLibraryOnLoadFailure(devCtx)).toBe(true);
  });
});
