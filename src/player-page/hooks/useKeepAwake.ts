import { useCallback, useEffect, useRef } from 'react';

interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

interface WakeLockApi {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

/** The preload bridge, present only when this page is the top-level document. */
function getBridge(): ((enabled: boolean) => void) | null {
  const api = (window as unknown as {
    animecix?: { setKeepAwake?: (enabled: boolean) => Promise<void> };
  }).animecix;

  if (typeof api?.setKeepAwake !== 'function') {
    return null;
  }
  return (enabled: boolean) => {
    api.setKeepAwake?.(enabled).catch(() => { /* non-fatal */ });
  };
}

function getWakeLock(): WakeLockApi | undefined {
  return (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock;
}

/**
 * Keeps the screen awake for as long as the video is playing.
 *
 * Chromium holds a wake lock of its own while a <video> plays, but ties it to
 * the element staying *visible* — and inside an iframe that visibility is
 * clipped by the embedding page's viewport, so scrolling the watch page down to
 * the comments releases it mid-episode and the display dims.
 *
 * Two paths, because the player runs in two shapes:
 *
 *  - Offline playback navigates the window straight to the player, making it the
 *    top-level document, which means it has the preload bridge (the same path
 *    `useVideoData` uses for `getOfflineVideoData`). That hands the request to
 *    `powerSaveBlocker` in the main process — the OS-level blocker, released by
 *    the window's own lifecycle if this page goes away without saying so.
 *  - Embedded in animecix.tv the bridge is out of reach (the preload does not run
 *    in sub-frames), so we fall back to the renderer's Screen Wake Lock API. The
 *    website also drives the main-process blocker off the play/pause
 *    postMessages, so that path is covered twice; this one costs nothing when the
 *    API is missing or the frame was not granted the policy.
 */
export function useKeepAwake() {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  /** Whether playback wants the screen held awake right now. */
  const wantedRef = useRef(false);
  const requestingRef = useRef(false);

  const dropSentinel = useCallback(() => {
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    sentinel?.release().catch(() => { /* non-fatal */ });
  }, []);

  const requestSentinel = useCallback(async () => {
    const wakeLock = getWakeLock();
    if (!wakeLock || sentinelRef.current || requestingRef.current) return;
    // A hidden page cannot take a lock, and loses the one it holds. The
    // visibilitychange listener below asks again once we are back.
    if (document.visibilityState !== 'visible') return;

    requestingRef.current = true;
    try {
      const sentinel = await wakeLock.request('screen');
      sentinel.addEventListener('release', () => {
        if (sentinelRef.current === sentinel) sentinelRef.current = null;
      });
      sentinelRef.current = sentinel;
    } catch {
      // Policy-blocked, or the page was torn down mid-request.
      return;
    } finally {
      requestingRef.current = false;
    }

    // Playback stopped while the request was in flight, so nobody wants the
    // lock we just got.
    if (!wantedRef.current) dropSentinel();
  }, [dropSentinel]);

  /** Playback started. */
  const acquire = useCallback(() => {
    wantedRef.current = true;
    const bridge = getBridge();
    if (bridge) {
      bridge(true);
      return;
    }
    void requestSentinel();
  }, [requestSentinel]);

  /** Playback stopped — let the screen dim as usual. */
  const release = useCallback(() => {
    wantedRef.current = false;
    const bridge = getBridge();
    if (bridge) {
      bridge(false);
      return;
    }
    dropSentinel();
  }, [dropSentinel]);

  useEffect(() => {
    function onVisibilityChange() {
      if (getBridge()) return; // The blocker is held in the main process.
      if (document.visibilityState !== 'visible') {
        // The browser drops the lock on hide; keep our bookkeeping in step so
        // the next request is not skipped as a duplicate.
        sentinelRef.current = null;
        return;
      }
      if (wantedRef.current) void requestSentinel();
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      wantedRef.current = false;
      getBridge()?.(false);
      dropSentinel();
    };
  }, [requestSentinel, dropSentinel]);

  return { acquire, release };
}
