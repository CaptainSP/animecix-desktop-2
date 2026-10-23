import { useCallback, useState } from 'react';

const ANNOUNCEMENTS_KEY = 'vds-player::announcements';

/** Reads the persisted announcements preference (default: on). */
function readAnnouncementsPref(): boolean {
  try {
    const saved = localStorage.getItem(ANNOUNCEMENTS_KEY);
    return saved != null ? saved === 'true' : true;
  } catch {
    return true;
  }
}

/**
 * Shared announcements toggle state. The FlatSettingsMenu checkbox writes it;
 * GlassControls reads it to mount/unmount <MediaAnnouncer>. Mirrors the
 * default layout's userPrefersAnnouncements signal (same storage key).
 */
export function useAnnouncementsPref(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState(readAnnouncementsPref);

  const set = useCallback((next: boolean) => {
    setEnabled(next);
    try {
      localStorage.setItem(ANNOUNCEMENTS_KEY, String(next));
    } catch {
      // Storage unavailable — the toggle still works in-memory.
    }
  }, []);

  return [enabled, set];
}
