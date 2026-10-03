import { describe, expect, it } from 'vitest';
import { normalisePushMessage, resolvePushUrl } from '../../src/notifications/push-message';

const SITE = 'https://animecix.tv';

describe('normalisePushMessage', () => {
  it('prefers the notification block over the data mirror', () => {
    const payload = normalisePushMessage(
      {
        notification: { title: 'Bölüm eklendi', body: 'Görüntülemek için tıklayın.' },
        data: { tit: 'eski başlık', bod: 'eski gövde' },
      },
      SITE,
    );

    expect(payload).toEqual({
      title: 'Bölüm eklendi',
      body: 'Görüntülemek için tıklayın.',
      url: null,
      image: null,
    });
  });

  it('falls back to the data keys for a data-only push', () => {
    const payload = normalisePushMessage(
      {
        data: {
          tit: 'Yeni mesaj',
          bod: 'Sana bir mesaj geldi',
          lin: 'https://animecix.tv/messages',
          img: 'https://cdn.example/poster.jpg',
        },
      },
      SITE,
    );

    expect(payload).toEqual({
      title: 'Yeni mesaj',
      body: 'Sana bir mesaj geldi',
      url: 'https://animecix.tv/messages',
      image: 'https://cdn.example/poster.jpg',
    });
  });

  it('returns null when there is nothing to show', () => {
    expect(normalisePushMessage({ data: { lin: 'https://animecix.tv/x' } }, SITE)).toBeNull();
    expect(normalisePushMessage({}, SITE)).toBeNull();
  });

  it('substitutes the app name when only a body is present', () => {
    const payload = normalisePushMessage({ data: { bod: 'sadece gövde' } }, SITE);
    expect(payload?.title).toBe('AnimeciX');
    expect(payload?.body).toBe('sadece gövde');
  });

  it('ignores whitespace-only values', () => {
    const payload = normalisePushMessage(
      { notification: { title: '   ' }, data: { tit: 'veriden gelen' } },
      SITE,
    );
    expect(payload?.title).toBe('veriden gelen');
  });

  it('drops a link that is not on the site origin', () => {
    const payload = normalisePushMessage(
      { data: { tit: 'x', lin: 'https://evil.example/phish' } },
      SITE,
    );
    expect(payload?.url).toBeNull();
  });
});

describe('resolvePushUrl', () => {
  it('keeps same-origin absolute URLs', () => {
    expect(resolvePushUrl('https://animecix.tv/titles/1', SITE)).toBe(
      'https://animecix.tv/titles/1',
    );
  });

  it('resolves relative links against the site origin', () => {
    expect(resolvePushUrl('/titles/1/season/1/episode/2', SITE)).toBe(
      'https://animecix.tv/titles/1/season/1/episode/2',
    );
  });

  it('re-hosts legacy animecix domains by path', () => {
    // The backend still builds animecix.net links for episode notifications
    // (animecix-js mobile-notifications-controller).
    expect(resolvePushUrl('https://animecix.net/titles/5/season/1/episode/3', SITE)).toBe(
      'https://animecix.tv/titles/5/season/1/episode/3',
    );
    expect(resolvePushUrl('https://www.animecix.com/titles/5?x=1', SITE)).toBe(
      'https://animecix.tv/titles/5?x=1',
    );
  });

  it('rejects non-http schemes', () => {
    expect(resolvePushUrl('javascript:alert(1)', SITE)).toBeNull();
    expect(resolvePushUrl('file:///etc/passwd', SITE)).toBeNull();
    expect(resolvePushUrl('animecix://login%7Babc%7D', SITE)).toBeNull();
  });

  it('rejects off-site hosts, including lookalikes', () => {
    expect(resolvePushUrl('https://animecix.tv.evil.example/x', SITE)).toBeNull();
    expect(resolvePushUrl('https://notanimecix.net/x', SITE)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(resolvePushUrl(undefined, SITE)).toBeNull();
    expect(resolvePushUrl('', SITE)).toBeNull();
    expect(resolvePushUrl(null, SITE)).toBeNull();
  });
});
