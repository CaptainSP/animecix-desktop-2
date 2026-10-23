import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { X509Certificate } from 'node:crypto';
import { PLAYER_HOST, getPlayerBaseUrl } from '../../src/player/tau-localhost';
import { buildTlsRedirectUrl } from '../../src/network/request-handler';

describe('player localhost identity', () => {
  it('uses the exact loopback hostname (never a suffix match)', () => {
    expect(PLAYER_HOST).toBe('tau-player.localhost');
  });

  it('reports no base URL before the server starts', () => {
    expect(getPlayerBaseUrl()).toBeNull();
  });
});

describe('buildTlsRedirectUrl', () => {
  const HTTP = 34731;
  const TLS = 45805;

  it('moves an upgraded embed URL to the TLS listener, keeping path+query', () => {
    expect(
      buildTlsRedirectUrl(
        `https://tau-player.localhost:${HTTP}/embed/68ea4df2?vid=732174`,
        HTTP,
        TLS
      )
    ).toBe(`https://tau-player.localhost:${TLS}/embed/68ea4df2?vid=732174`);
  });

  it('ignores URLs already on the TLS port (no redirect loop)', () => {
    expect(
      buildTlsRedirectUrl(`https://tau-player.localhost:${TLS}/embed/x`, HTTP, TLS)
    ).toBeNull();
  });

  it('ignores plain-HTTP URLs (served directly, no upgrade involved)', () => {
    expect(
      buildTlsRedirectUrl(`http://tau-player.localhost:${HTTP}/embed/x`, HTTP, TLS)
    ).toBeNull();
  });

  it('ignores foreign hosts, even lookalikes', () => {
    expect(buildTlsRedirectUrl('https://tau-player.localhost.evil.com/embed/x', HTTP, TLS)).toBeNull();
    expect(buildTlsRedirectUrl('https://animecix.tv/embed/x', HTTP, TLS)).toBeNull();
    expect(buildTlsRedirectUrl('https://localhost:9999/embed/x', HTTP, TLS)).toBeNull();
  });

  it('ignores unknown ports and unstarted servers', () => {
    expect(buildTlsRedirectUrl(`https://tau-player.localhost:9999/embed/x`, HTTP, TLS)).toBeNull();
    expect(buildTlsRedirectUrl(`https://tau-player.localhost:${HTTP}/embed/x`, 0, TLS)).toBeNull();
    expect(buildTlsRedirectUrl(`https://tau-player.localhost:${HTTP}/embed/x`, HTTP, 0)).toBeNull();
    expect(buildTlsRedirectUrl(`https://tau-player.localhost:${HTTP}/embed/x`, HTTP, HTTP)).toBeNull();
  });

  it('ignores malformed URLs', () => {
    expect(buildTlsRedirectUrl('not-a-url', HTTP, TLS)).toBeNull();
  });
});

describe('bundled TLS credentials', () => {
  const crtPath = path.join('assets', 'certs', 'tau-player.localhost.crt');
  const keyPath = path.join('assets', 'certs', 'tau-player.localhost.key');

  it('ships a certificate and key outside the served player directory', () => {
    expect(fs.existsSync(crtPath)).toBe(true);
    const key = fs.readFileSync(keyPath, 'utf8');
    expect(key).toContain('PRIVATE KEY');
    // Must not live under assets/player/ — that tree is served over HTTP(S).
    expect(path.resolve(crtPath).startsWith(path.resolve('assets', 'player'))).toBe(false);
  });

  it('covers exactly tau-player.localhost and is long-lived', () => {
    const cert = new X509Certificate(fs.readFileSync(crtPath));
    expect(cert.subject).toContain('tau-player.localhost');
    expect(cert.subjectAltName ?? '').toContain('DNS:tau-player.localhost');
    // Valid well into the future so packaged apps don't rot.
    const fiveYearsMs = 5 * 365 * 24 * 3600 * 1000;
    expect(new Date(cert.validTo).getTime()).toBeGreaterThan(Date.now() + fiveYearsMs);
  });
});
