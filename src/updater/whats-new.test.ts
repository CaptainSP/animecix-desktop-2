import { describe, it, expect } from 'vitest';
import {
  buildWhatsNewScript,
  shouldAnnounce,
  shouldRecordVersion,
  WHATS_NEW_SCRIPT,
} from './whats-new';

describe('whats-new announcement gating', () => {
  it('never announces on a fresh install', () => {
    expect(shouldAnnounce(true, null, '0.1.27')).toBe(false);
    expect(shouldAnnounce(true, '0.1.26', '0.1.27')).toBe(false);
  });

  it('announces when an existing install updates to a new version', () => {
    expect(shouldAnnounce(false, '0.1.26', '0.1.27')).toBe(true);
  });

  it('announces when an existing install has no recorded version (pre-feature DB)', () => {
    expect(shouldAnnounce(false, null, '0.1.27')).toBe(true);
  });

  it('does not re-announce for the same version', () => {
    expect(shouldAnnounce(false, '0.1.27', '0.1.27')).toBe(false);
  });
});

describe('whats-new version recording', () => {
  it('records the version once the announcement has been shown', () => {
    expect(shouldRecordVersion('shown')).toBe(true);
  });

  it('records the version when no note was authored for it', () => {
    // Nothing to show; re-asking every launch would be pointless.
    expect(shouldRecordVersion('none')).toBe(true);
  });

  it('leaves the version unrecorded when the lookup failed', () => {
    // Most likely offline — burning the version here would swallow the
    // announcement permanently.
    expect(shouldRecordVersion('error')).toBe(false);
  });
});

describe('whats-new injected script', () => {
  it('parses as valid JavaScript (no template-literal interpolation leaks)', () => {
    expect(() => new Function(WHATS_NEW_SCRIPT)).not.toThrow();
  });

  it('reads its content from the release notes endpoint', () => {
    expect(WHATS_NEW_SCRIPT).toContain("'/secure/windows-release-notes?version='");
  });

  it('reports back whether it showed anything', () => {
    expect(WHATS_NEW_SCRIPT).toContain("return 'shown'");
    expect(WHATS_NEW_SCRIPT).toContain("return 'none'");
    expect(WHATS_NEW_SCRIPT).toContain("return 'error'");
  });

  it('builds the item rows with textContent, never innerHTML', () => {
    // The strings come from the admin panel and land in animecix.tv's DOM.
    expect(WHATS_NEW_SCRIPT).not.toContain('innerHTML');
  });

  it('keeps the dialog chrome that is not authored server-side', () => {
    expect(WHATS_NEW_SCRIPT).toContain('Harika, anladım');
    expect(WHATS_NEW_SCRIPT).toContain('wn-card');
  });

  it('no longer hardcodes release copy', () => {
    expect(WHATS_NEW_SCRIPT).not.toContain('Toplu İndir');
    expect(WHATS_NEW_SCRIPT).not.toContain('Sezon Seçimi');
  });
});

describe('buildWhatsNewScript', () => {
  it('hands the app version over as a JSON-encoded assignment', () => {
    const script = buildWhatsNewScript('0.1.28');
    expect(script).toContain('window.__animecixAppVersion = "0.1.28";');
    expect(script.endsWith(WHATS_NEW_SCRIPT)).toBe(true);
  });

  it('stays valid JavaScript for a version containing quotes', () => {
    const script = buildWhatsNewScript('0.1.28"; alert(1); //');
    expect(() => new Function(script)).not.toThrow();
  });
});
