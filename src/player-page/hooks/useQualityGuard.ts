import { useCallback, useRef } from 'react';
import type { MediaPlayerInstance } from '@vidstack/react';

/**
 * How long a quality switch may take before we treat it as failed. Swapping an
 * MP4 source means a fresh request to a mirror, so this has to tolerate a slow
 * start without leaving the viewer on a dead spinner.
 */
const SWITCH_TIMEOUT_MS = 10000;

interface QualityGuardOptions {
  /**
   * Pin the quality once the first one has played. Only meaningful for the
   * multi-file MP4 sources: Vidstack picks their "auto" quality from the
   * rendered player size and re-picks on every resize, and each pick swaps
   * `video.src`, so going fullscreen or rotating a phone restarts the episode
   * mid-playback. HLS must keep auto — hls.js switches inside one buffer and
   * never reloads.
   */
  pinAuto: boolean;
}

/**
 * Keeps quality switching from interrupting playback: it stops the
 * size-driven auto switching after the first pick, and puts the viewer back on
 * the quality that was working when a switch fails to come up.
 *
 * The returned handlers are wired to the player's own events by the caller.
 */
export function useQualityGuard(
  playerRef: React.RefObject<MediaPlayerInstance | null>,
  { pinAuto }: QualityGuardOptions
) {
  const lastGoodIdRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  /** Set while a revert is in flight so a second failure cannot ping-pong. */
  const revertingRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onSwitchFailed = useCallback(() => {
    clearTimer();

    const player = playerRef.current;
    const lastGoodId = lastGoodIdRef.current;
    if (!player || !lastGoodId || revertingRef.current) return;

    const target = player.qualities
      .toArray()
      .find((quality) => quality.id === lastGoodId);
    if (!target || target.selected) return;

    // Vidstack stores the playback position across a quality change and
    // restores it on the replacement source, so the revert carries the viewer
    // back to where they were without us tracking the time ourselves.
    revertingRef.current = true;
    target.selected = true;
  }, [playerRef, clearTimer]);

  /** Call when the player reports a quality change. */
  const handleQualityChange = useCallback(() => {
    clearTimer();
    timerRef.current = window.setTimeout(onSwitchFailed, SWITCH_TIMEOUT_MS);
  }, [clearTimer, onSwitchFailed]);

  /** Call when the player reports an error. */
  const handleError = useCallback(() => {
    onSwitchFailed();
  }, [onSwitchFailed]);

  /** Call when the player reaches `canPlay`. */
  const handleCanPlay = useCallback(() => {
    clearTimer();
    revertingRef.current = false;

    const player = playerRef.current;
    if (!player) return;

    const selected = player.qualities.selected;
    if (!selected) return;

    lastGoodIdRef.current = selected.id;

    // Re-selecting the quality that is already playing is what turns auto off,
    // which is what tears down Vidstack's resize watcher. Re-selecting the
    // current item raises no "change" event, so nothing reads this as a manual
    // pick. Viewers who want the old behaviour can still choose "Otomatik".
    if (pinAuto && player.qualities.auto) {
      selected.selected = true;
    }
  }, [playerRef, pinAuto, clearTimer]);

  // No reset on source change: `source-change` also fires for quality switches
  // (it carries the quality-change event as its trigger), so clearing here
  // would cancel the very watchdog this hook just armed. Episode changes sort
  // themselves out instead — the next `canPlay` overwrites the last good id,
  // and quality ids are shared across episodes anyway.

  return { handleQualityChange, handleError, handleCanPlay };
}
