/** Written by Vidstack itself, keyed by the player's `storage` prop. */
const VIDSTACK_STORAGE_KEY = 'tau-video';
/** Written by the desktop player's useQualityPersistence. */
const DESKTOP_QUALITY_KEY = 'tau-video-quality';

function readHeight(key: string, pick: (parsed: any) => any): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const height = pick(JSON.parse(raw))?.height;
    return typeof height === 'number' && height > 0 ? height : null;
  } catch {
    // Storage unavailable or corrupt — fall back to no preference.
    return null;
  }
}

/**
 * The quality height the player is going to ask for once it is ready, or null
 * when the viewer has never picked one.
 *
 * Both players restore a stored quality right after `canPlay`. If that quality
 * is not the source already loading, restoring it swaps `video.src` and the
 * browser aborts the request in flight — which leaves the element with metadata,
 * an empty buffer and NETWORK_IDLE, and a `play()` promise that never settles.
 * Leading the source list with this height makes the restore a no-op instead of
 * a second load.
 */
export function readPreferredQualityHeight(): number | null {
  return (
    readHeight(DESKTOP_QUALITY_KEY, (parsed) => parsed) ??
    readHeight(VIDSTACK_STORAGE_KEY, (parsed) => parsed?.quality)
  );
}
