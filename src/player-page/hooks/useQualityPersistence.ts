import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { MediaPlayerInstance } from '@vidstack/react';

// Key is shared across all tau-player://bundle pages (same origin), so the
// preference survives both iframe reloads (episode switch) and same-document
// src changes (changeVideo bridge message).
const QUALITY_KEY = 'tau-video-quality';
// Long enough to cover the player mounting after the skip-marker fetch.
const MAX_RESTORE_ATTEMPTS = 300;
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
 * Bumped every time the viewer picks a quality by hand (see QualityMenu).
 * A restore polling in the background must never override a newer manual
 * pick: if the quality list arrives late (slow manifest) the poll would
 * otherwise stamp the saved/default value over what the viewer just chose.
 */
let manualPickEpoch = 0;

export function markManualQualityPick(): void {
  manualPickEpoch += 1;
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
 * The tallest quality in the list — the default every episode opens at while
 * the viewer has no pick on record. Vidstack's own pick is scored against the
 * rendered player size and lands on 720p in this window; the viewer asked for
 * the best available quality (1080p on sources that have it) instead. The
 * pick is deliberately not saved, so it stays a default and a later manual
 * selection still wins on the next episode.
 */
export function findTallestQuality<T extends QualityLike>(
  qualities: readonly T[]
): T | null {
  let top: T | null = null;
  for (const quality of qualities) {
    if (top === null || (quality.height ?? 0) > (top.height ?? 0)) {
      top = quality;
    }
  }
  return top;
}

/**
 * Re-applies the viewer's quality preference whenever an episode loads.
 *
 * WHY (PLAY-05): Vidstack's built-in quality storage is switched off (see
 * PlayerStorage), so this is the only place a stored quality comes back.
 *
 * Saving happens in QualityMenu, on the viewer's own pick only. Listening to
 * the quality list here used to save every change, including useQualityGuard
 * reverting a slow switch and Vidstack's own restores, so one failed 1080p
 * switch left the preference stuck on 480p.
 */
export function useQualityPersistence(
  playerRef: RefObject<MediaPlayerInstance | null>,
  sourcesSignature: string | null
) {
  // Re-apply the saved preference whenever new sources load. Qualities are
  // populated asynchronously (manifest/source elements), so poll briefly.
  useEffect(() => {
    if (!sourcesSignature) return;

    const sourceUrls = new Set(sourcesSignature.split('|'));
    // Picks made after this effect started win over the restore.
    const epoch = manualPickEpoch;
    let attempts = 0;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tryRestore = (): boolean => {
      // A newer manual pick landed while polling — stop and leave it alone.
      if (manualPickEpoch !== epoch) return true;
      // useVideoData sets `data` before it clears `loading` (that waits on the
      // skip-marker fetch), so the player is usually not mounted yet when this
      // first runs. Giving up here meant the restore never happened on a fresh
      // load, and Vidstack's size-based auto pick — 480p in the iframe — won.
      const player = playerRef.current;
      if (!player) return false;

      const qualities = player.qualities.toArray();
      if (qualities.length === 0) return false;

      // On a same-document episode switch the list can still hold the previous
      // episode's files for a tick; selecting one of those would be lost when
      // they are swapped out. HLS levels carry no src and are taken as-is.
      const isCurrentList = qualities.every((quality) => {
        const src = (quality as { src?: unknown }).src;
        return typeof src !== 'string' || sourceUrls.has(src);
      });
      if (!isCurrentList) return false;

      const saved = loadSavedQuality();
      // No pick on record: open the episode at the top of the ladder (1080p
      // where available) rather than leaving Vidstack's size-based auto to
      // settle on 720p.
      const best = saved
        ? findBestQualityMatch(qualities, saved)
        : findTallestQuality(qualities);
      if (best) best.selected = true;
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
