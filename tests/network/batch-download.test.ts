import { describe, it, expect } from 'vitest';
import { isTitlePageUrl } from '../../src/network/batch-download';
import { BATCH_DOWNLOAD_SCRIPT } from '../../src/network/batch-download-script';

describe('batch-download injection', () => {
  it('returns true for title list pages', () => {
    expect(
      isTitlePageUrl('https://animecix.tv/titles/12805/hell-mode-some-title')
    ).toBe(true);
  });

  it('returns true for plain title id pages', () => {
    expect(isTitlePageUrl('https://animecix.tv/titles/12805')).toBe(true);
  });

  it('returns false for title edit pages', () => {
    expect(
      isTitlePageUrl('https://animecix.tv/titles/12805/hell-mode/edit')
    ).toBe(false);
  });

  it('returns false for non-title pages', () => {
    expect(isTitlePageUrl('https://animecix.tv/')).toBe(false);
    expect(isTitlePageUrl('https://animecix.tv/browse')).toBe(false);
    expect(isTitlePageUrl('https://animecix.tv/people/42/some-name')).toBe(false);
  });

  it('returns false for malformed URLs', () => {
    expect(isTitlePageUrl('not-a-url')).toBe(false);
  });
});

describe('batch-download injected script', () => {
  it('parses as valid JavaScript (no template-literal interpolation leaks)', () => {
    expect(() => new Function(BATCH_DOWNLOAD_SCRIPT)).not.toThrow();
  });

  it('talks to the backend batch endpoints', () => {
    expect(BATCH_DOWNLOAD_SCRIPT).toContain("'/secure/batch-download/'");
    expect(BATCH_DOWNLOAD_SCRIPT).toContain("apiGet(titleId + '/episodes')");
    expect(BATCH_DOWNLOAD_SCRIPT).toContain("apiPost(titleId + '/videos'");
  });

  it('no longer re-implements the site AES request signature', () => {
    // The endpoints live outside /secure/titles, so validate-aes-request does
    // not apply. Re-introducing the signing would mean shipping the site's key
    // inside the desktop app again.
    expect(BATCH_DOWNLOAD_SCRIPT).not.toContain('X-E-H');
    expect(BATCH_DOWNLOAD_SCRIPT).not.toContain('AES-GCM');
    expect(BATCH_DOWNLOAD_SCRIPT).not.toContain('crypto.subtle');
  });

  it('sends the CSRF header on writes', () => {
    // /secure POSTs are behind the double-submit cookie check; without the
    // echoed header every resolve request would come back 403.
    expect(BATCH_DOWNLOAD_SCRIPT).toContain("'X-XSRF-TOKEN': readXsrfToken()");
  });

  it('resolves sources in batches rather than one request per episode', () => {
    expect(BATCH_DOWNLOAD_SCRIPT).toContain('RESOLVE_CHUNK');
    // The old flow called the per-video tau lookup once per episode.
    expect(BATCH_DOWNLOAD_SCRIPT).not.toContain('fetchVideoData');
    expect(BATCH_DOWNLOAD_SCRIPT).not.toContain('episode-videos-points');
  });

  it('keys downloads by the backend episodeId', () => {
    // Must match the website's getIdentifier ("titleId_season_episode"),
    // otherwise a batch-downloaded episode never reads back as available
    // offline for the episode the user downloaded.
    expect(BATCH_DOWNLOAD_SCRIPT).toContain(
      'downloadVideo(item.episodeId, url, item.downloadTitle'
    );
    expect(BATCH_DOWNLOAD_SCRIPT).not.toContain('ep._id');
  });
});
