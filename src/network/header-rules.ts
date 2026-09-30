export interface HeaderRule {
  urlPatterns: string[];
  headers: {
    referer?: string;
    userAgent?: string;
  };
  purpose: string;
}

export const FIREFOX_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:70.0) Gecko/20100101 Firefox/70.0';

const CDN = import.meta.env.VITE_CDN_DOMAIN;

/**
 * Second origin the video backend hands out, for files stored on R2.
 *
 * Hardcoded rather than read from an env var on purpose: the VITE_* values are
 * supplied as CI secrets, and a name that is not wired up there resolves to
 * `undefined`, which would silently turn the patterns below into
 * "*://*.undefined/*". tau-backend has this host as a literal too.
 *
 * These URLs are stored complete in the database, so replaceVideoUrl (which
 * only rewrites URLs starting with the cdn4 prefix) passes them through
 * untouched and the player receives them as-is.
 */
const R2_DOMAIN = 'irtau1.online';

export const HEADER_RULES: HeaderRule[] = [
  {
    urlPatterns: [`*://*.${CDN}/file/*`],
    headers: { referer: `https://${CDN}/`, userAgent: FIREFOX_UA },
    purpose:
      'Video file CDN -- needs referer from embed page and Firefox UA to authorize',
  },
  {
    urlPatterns: [`*://*.${CDN}/api/*`],
    headers: { referer: `https://${CDN}/` },
    purpose: 'API requests -- needs referer for auth',
  },
];

/**
 * URL filter for the ACAO override in header-rewriter. The override must ONLY
 * touch the video CDN (whose cross-origin media the player reads from the
 * tau-player.localhost origin) and NEVER challenges.cloudflare.com, whose
 * credentialed CORS responses break if their ACAO is forced to '*'.
 * Whole-domain scope so m3u8 playlists and segments are all covered.
 */
export const CDN_ACAO_URL_PATTERNS = [
  // Both the apex and its subdomains: an Electron pattern of "*.host" does NOT
  // match the bare host, so "*://*.tau-video.xyz/*" alone skipped every apex
  // URL — isVideoCdnUrl already counted those as CDN, so the two disagreed.
  `*://${CDN}/*`,
  `*://*.${CDN}/*`,
  `*://${R2_DOMAIN}/*`,
  `*://*.${R2_DOMAIN}/*`,
];

/**
 * Pure predicate: is this URL served by the video CDN? Used to keep the ACAO
 * override scoped to the CDN (and testable without Electron).
 */
export function isVideoCdnUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return [CDN, R2_DOMAIN].some(
      (domain) => host === domain || host.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

/**
 * Pure function: check if a URL matches any rule (for testing and header rewriter).
 * Converts Electron URL pattern wildcards to regex and tests the given URL.
 */
export function matchesHeaderRule(
  url: string,
  rules: HeaderRule[]
): HeaderRule | null {
  for (const rule of rules) {
    for (const pattern of rule.urlPatterns) {
      // Convert Electron URL pattern to regex.
      // Steps:
      //   1. Protect all * chars with a placeholder
      //   2. Escape all regex special chars (including dots)
      //   3. Replace scheme wildcard placeholder (___STAR___://) with [a-z]+://
      //   4. Replace remaining placeholders with .*
      //   5. Make subdomain wildcard optional (*.domain matches bare domain too)
      const regexStr =
        '^' +
        pattern
          .replace(/\*/g, '___STAR___')
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
          .replace(/___STAR___:\/\//g, '[a-z]+://')
          .replace(/___STAR___/g, '.*')
          .replace(/:\/\/\.\*\\\./g, '://(.*\\.)?') +
        '$';
      const regex = new RegExp(regexStr);
      if (regex.test(url)) return rule;
    }
  }
  return null;
}
