import { useCallback, useEffect, useRef } from 'react';
import type { MediaPlayerInstance } from '@vidstack/react';

/** How often to look at the playhead while we are waiting for playback to start. */
const POLL_MS = 500;
/** Time to allow before assuming playback will not start on its own. */
const NUDGE_AFTER_MS = 2500;
/** Time after which a seek is clearly not enough and the element needs reloading. */
const RELOAD_AFTER_MS = 5000;
/** Time after which even a reload has not helped. */
const GIVE_UP_AFTER_MS = 9000;
/** Landing this far inside a buffered range, rather than exactly on its edge. */
const NUDGE_PADDING = 0.1;

interface PlaybackRecoveryOptions {
  /** Called when neither a seek nor a reload got playback going. */
  onUnrecoverable: () => void;
}

/**
 * Recovers from a playback start that never happens.
 *
 * The failure looks like this, captured while stuck: `readyState` 1,
 * `networkState` NETWORK_IDLE, `buffered` empty, duration known. The element
 * accepted `play()` and reports `paused === false`, but it is not fetching
 * anything, so `playing` never fires. Nothing settles the `play()` promise in
 * that state — it is neither an error nor an autoplay refusal — and the viewer
 * is left on a black frame.
 *
 * It happens because a second `load()` aborts the fetch the first one started:
 * the stored quality preference is restored right after `canPlay`, and if it
 * does not match the source already loading, the swap kills the in-flight
 * request. Setting `preload` back to `auto` does not revive it; only re-running
 * the resource selection algorithm does. So that is the escalation: seek first,
 * since it is cheap and keeps the buffer, then reload, then give up.
 */
export function usePlaybackRecovery(
  playerRef: React.RefObject<MediaPlayerInstance | null>,
  { onUnrecoverable }: PlaybackRecoveryOptions
) {
  const intervalRef = useRef<number | null>(null);
  const armedAtRef = useRef(0);
  const nudgedRef = useRef(false);
  const reloadedRef = useRef(false);
  const onUnrecoverableRef = useRef(onUnrecoverable);
  onUnrecoverableRef.current = onUnrecoverable;

  const disarm = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const nudge = useCallback((player: MediaPlayerInstance) => {
    const { buffered } = player.state;
    const from = player.currentTime;

    // Prefer the start of the next range that actually holds data; a hole at
    // the head of the stream is the common shape here.
    let target = from + 0.5;
    for (let i = 0; i < buffered.length; i++) {
      if (buffered.start(i) > from) {
        target = buffered.start(i) + NUDGE_PADDING;
        break;
      }
    }

    player.currentTime = target;
    player.play().catch(() => {});
  }, []);

  const reload = useCallback((player: MediaPlayerInstance) => {
    const media = document.querySelector('video');
    if (!media) return;

    // load() restarts from zero, so carry the playhead over ourselves.
    const resumeAt = player.currentTime;
    media.preload = 'auto';
    media.load();

    if (resumeAt > 1) {
      media.addEventListener(
        'loadeddata',
        () => {
          media.currentTime = resumeAt;
        },
        { once: true }
      );
    }

    media.play().catch(() => {});
  }, []);

  /** Start watching. Call once playback has been requested. */
  const arm = useCallback(() => {
    disarm();
    armedAtRef.current = Date.now();
    nudgedRef.current = false;
    reloadedRef.current = false;

    intervalRef.current = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;

      // Actually playing — nothing to recover.
      if (player.state.playing) {
        disarm();
        return;
      }

      // Paused means something decided not to play: the viewer, or the autoplay
      // policy rejecting `play()`. Neither is a stall, so leave them alone.
      if (player.paused) return;

      const waitedMs = Date.now() - armedAtRef.current;

      if (!nudgedRef.current && waitedMs >= NUDGE_AFTER_MS) {
        nudgedRef.current = true;
        nudge(player);
        return;
      }

      if (!reloadedRef.current && waitedMs >= RELOAD_AFTER_MS) {
        reloadedRef.current = true;
        reload(player);
        return;
      }

      if (waitedMs >= GIVE_UP_AFTER_MS) {
        disarm();
        onUnrecoverableRef.current();
      }
    }, POLL_MS);
  }, [playerRef, disarm, nudge, reload]);

  useEffect(() => disarm, [disarm]);

  return { arm, disarm };
}
