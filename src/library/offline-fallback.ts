/**
 * offline-fallback.ts -- Pure decision logic for dropping into the offline
 * library when the website cannot be reached.
 *
 * Extracted from main.ts (Per D-04) so the behavior is unit-testable. The
 * main process combines this with net.isOnline() as a fast path: isOnline()
 * is unreliable (Chromium reports "online" while the site is unreachable,
 * e.g. router up but no WAN connection), so a main-frame load failure with a
 * network error code is the authoritative trigger.
 */

export const OFFLINE_NETWORK_ERROR_CODES: ReadonlySet<number> = new Set([
  -101, // ERR_CONNECTION_RESET
  -102, // ERR_CONNECTION_REFUSED
  -105, // ERR_NAME_NOT_RESOLVED
  -106, // ERR_INTERNET_DISCONNECTED
  -109, // ERR_ADDRESS_UNREACHABLE
  -118, // ERR_CONNECTION_TIMED_OUT
]);

export const ABORTED_ERROR_CODE = -3; // ERR_ABORTED -- replaced by another navigation

export interface LoadFailureContext {
  errorCode: number;
  isMainFrame: boolean;
  validatedURL: string;
  devSiteURL: string;
  isPackaged: boolean;
  libraryVisible: boolean;
}

export function shouldOpenLibraryOnLoadFailure(ctx: LoadFailureContext): boolean {
  if (ctx.libraryVisible) return false; // already inside the library
  if (!ctx.isMainFrame) return false; // subframe failures are non-fatal
  if (ctx.errorCode === ABORTED_ERROR_CODE) return false; // superseded navigation
  if (!OFFLINE_NETWORK_ERROR_CODES.has(ctx.errorCode)) return false;
  // In dev, WindowService retries the real site when the localhost dev server
  // is down -- don't preempt that fallback before it has a chance to run.
  if (!ctx.isPackaged && ctx.validatedURL.startsWith(ctx.devSiteURL)) return false;
  return true;
}
