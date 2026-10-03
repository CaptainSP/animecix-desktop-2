// Pure translation from FCM's wire shape to PushNotificationPayload.
// Kept free of Electron and @eneris/push-receiver imports so it is unit
// testable in the node environment (tests/notifications/push-message.test.ts).

import type { PushNotificationPayload } from './push.types';

/** Shape of what FCM delivers; mirrors @eneris/push-receiver's Message. */
export interface RawPushMessage {
  notification?: {
    title?: string;
    body?: string;
    image?: string;
  };
  data?: Record<string, unknown>;
}

/**
 * Converts an FCM message into a payload the app can display.
 *
 * Why both sources: the backend fills the `notification` block AND mirrors the
 * same values into `data` as `tit`/`bod`/`lin`/`img`, because mobile relies on
 * the data keys (animecix-js services/firebase.ts). The `notification` block is
 * preferred, with the data keys as fallback — a message carrying only `data`
 * (a silent/data-only push) still renders.
 *
 * Returns null when there is nothing to show: a push with neither title nor
 * body is a backend bug, and an empty OS notification is worse than none.
 */
export function normalisePushMessage(
  message: RawPushMessage,
  siteUrl: string,
): PushNotificationPayload | null {
  const data = message.data ?? {};

  const title = firstString(message.notification?.title, data.tit);
  const body = firstString(message.notification?.body, data.bod);

  if (!title && !body) {
    return null;
  }

  return {
    title: title || 'AnimeciX',
    body: body || '',
    url: resolvePushUrl(firstString(data.lin), siteUrl),
    image: firstString(message.notification?.image, data.img) || null,
  };
}

/**
 * Resolves a push's link to an absolute URL on the site's own origin.
 *
 * Security: a push payload is untrusted input that ends up in
 * `webContents.loadURL`, so anything that is not an http(s) URL on the
 * configured site origin is dropped rather than sanitised. This rejects
 * `javascript:` and `file:` links, and off-site redirects that would turn a
 * notification click into an open-redirect inside the app window.
 *
 * Legacy hosts are accepted by PATH ONLY: the backend still builds links
 * against animecix.net (see animecix-js mobile-notifications-controller), so
 * the path is re-hosted onto the configured origin instead of being discarded.
 */
export function resolvePushUrl(
  raw: string | null | undefined,
  siteUrl: string,
): string | null {
  if (!raw) return null;

  let site: URL;
  try {
    site = new URL(siteUrl);
  } catch {
    return null;
  }

  let parsed: URL;
  try {
    // A relative link ("/titles/1") resolves against the site origin.
    parsed = new URL(raw, site);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }

  if (parsed.hostname === site.hostname) {
    return parsed.toString();
  }

  if (isKnownSiteHost(parsed.hostname)) {
    return new URL(parsed.pathname + parsed.search + parsed.hash, site).toString();
  }

  return null;
}

/**
 * Hosts that are the same product under a different domain. The backend has
 * produced animecix.net links for years; dropping them would mean every
 * episode notification opens nothing.
 */
const KNOWN_SITE_HOSTS = new Set([
  'animecix.com',
  'animecix.net',
  'animecix.tv',
]);

function isKnownSiteHost(hostname: string): boolean {
  const bare = hostname.replace(/^www\./, '');
  return KNOWN_SITE_HOSTS.has(bare);
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return '';
}
