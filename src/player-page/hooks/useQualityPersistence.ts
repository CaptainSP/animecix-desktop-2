import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { MediaPlayerInstance } from '@vidstack/react';

// Key is shared across all tau-player://bundle pages (same origin), so the
// preference survives both iframe reloads (episode switch) and same-document
// src changes (changeVideo bridge message).
const QUALITY_KEY = 'tau-video-quality';
const MAX_RESTORE_ATTEMPTS = 50;
const RESTORE_POLL_INTERVAL_MS = 100;

export interface QualityLike {
  width: number;
  height: number;
  bitrate: number | null;
}

export interface SavedQuality {
  width: number;
  height: number;
  bitrate: number;
}

/**
 * Reads the persisted manual quality preference, or null if the user left
 * quality on "Otomatik" (Auto) or storage is unavailable/corrupt.
 */
export function loadSavedQuality(): SavedQuality | null {
  try {
    const raw = localStorage.getItem(QUALITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedQuality>;
    if (typeof parsed.height !== 'number' || parsed.height <= 0) return null;
    return {
      width: parsed.width ?? 0,
      height: parsed.height,
      bitrate: parsed.bitrate ?? 0,
    };
  } catch {
    // Non-fatal: storage unavailable (e.g., tests) — treat as no preference
    return null;
  }
}

/**
 * Persists the manual quality selection. Passing null clears the preference
 * (user switched back to "Otomatik").
 */
export function saveQuality(quality: QualityLike | null): void {
  try {
    if (!quality) {
      localStorage.removeItem(QUALITY_KEY);
      return;
    }
    localStorage.setItem(
      QUALITY_KEY,
      JSON.stringify({
        width: quality.width,
        height: quality.height,
        bitrate: quality.bitrate ?? 0,
      })
    );
  } catch {
    // Non-fatal: storage unavailable — preference simply will not persist
  }
}

/**
 * Picks the available quality closest to the saved preference, mirroring
 * Vidstack's own matching (minimize width + height + bitrate distance).
 * Returns null for an empty list.
 */
export function findBestQualityMatch<T extends QualityLike>(
  qualities: readonly T[],
  saved: SavedQuality
): T | null {
  let best: T | null = null;
  let bestScore = Infinity;

  for (const quality of qualities) {
    const score =
      Math.abs(saved.width - quality.width) +
      Math.abs(saved.height - quality.height) +
      (saved.bitrate > 0 ? Math.abs(saved.bitrate - (quality.bitrate ?? 0)) : 0);
    if (score < bestScore) {
      best = quality;
      bestScore = score;
    }
  }

  return best;
}

/**
 * Persists the player's manual quality selection across episode switches.
 *
 * WHY (PLAY-05): Vidstack's built-in storage restores quality only on media
 * ready and is unreliable across iframe reloads, so the selection resets to
 * "Otomatik" (Auto) when the user changes episodes. This hook writes the
 * preference on every user-triggered quality change and re-applies it after
 * new sources load.
 *
 * Distinguishing user intent from list resets: a new video source rebuilds the
 * quality list and fires 'change' with current=null and 'auto-change' with
 * detail=false — neither of those clears the preference. Only a real "Otomatik"
 * selection (auto-change with detail=true) or a manual pick (change with a
 * selected quality while auto is off) modifies the stored preference.
 */
export function useQualityPersistence(
  playerRef: RefObject<MediaPlayerInstance | null>,
  sourcesSignature: string | null
) {
  // Save manual selections; clear when the user picks "Otomatik"
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    function onQualityChange() {
      if (player.qualities.auto) return;
      const selected = player.qualities.selected;
      if (selected) {
        saveQuality({
          width: selected.width,
          height: selected.height,
          bitrate: selected.bitrate,
        });
      }
    }

    function onAutoChange() {
      if (player.qualities.auto) saveQuality(null);
    }

    player.qualities.addEventListener('change', onQualityChange);
    player.qualities.addEventListener('auto-change', onAutoChange);

    return () => {
      player.qualities.removeEventListener('change', onQualityChange);
      player.qualities.removeEventListener('auto-change', onAutoChange);
    };
  }, [playerRef]);

  // Re-apply the saved preference whenever new sources load. Qualities are
  // populated asynchronously (manifest/source elements), so poll briefly.
  useEffect(() => {
    if (!sourcesSignature) return;

    let attempts = 0;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tryRestore = (): boolean => {
      const player = playerRef.current;
      if (!player) return true;

      const qualities = player.qualities.toArray();
      if (qualities.length === 0) return false;

      const saved = loadSavedQuality();
      if (saved) {
        const best = findBestQualityMatch(qualities, saved);
        if (best) best.selected = true;
      }
      return true;
    };

    timer = setInterval(() => {
      attempts += 1;
      if (tryRestore() || attempts >= MAX_RESTORE_ATTEMPTS) {
        if (timer) clearInterval(timer);
        timer = null;
      }
    }, RESTORE_POLL_INTERVAL_MS);

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [playerRef, sourcesSignature]);
}
