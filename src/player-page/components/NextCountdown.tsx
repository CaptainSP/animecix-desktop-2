import { useEffect, useRef, useState } from 'react';
import { useMediaState } from '@vidstack/react';
import type { SkipMeta } from '../types';
import { postToParent } from '../hooks/useParentMessages';

/** Countdown length in seconds, started when the outro begins. */
const COUNTDOWN_SECONDS = 5;

/* Minimal external store so SkipButton can stand down while the countdown
   owns the outro (intro and outro never overlap, so a boolean suffices). */
let countdownVisible = false;
const listeners = new Set<() => void>();

function setCountdownVisible(value: boolean): void {
  if (countdownVisible === value) return;
  countdownVisible = value;
  listeners.forEach((notify) => notify());
}

export function subscribeCountdown(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCountdownVisible(): boolean {
  return countdownVisible;
}

interface Props {
  meta: SkipMeta | null;
  hasNext: boolean;
}

/**
 * "Next episode in N seconds" pill shown when the outro starts. Counts
 * 5→1 with a blue fill draining right-to-left, then advances. X cancels
 * for this outro pass; clicking the pill advances immediately.
 */
export function NextCountdown({ meta, hasNext }: Props) {
  const currentTime = useMediaState('currentTime');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const prevTimeRef = useRef(0);
  const dismissedRef = useRef(false);
  const firedRef = useRef(false);

  const raw = meta?.outro;
  const outro =
    raw && 'from' in raw && typeof raw.from === 'number' && typeof raw.to === 'number'
      ? { from: raw.from, to: raw.to }
      : null;
  const outroKey = outro ? `${outro.from}-${outro.to}` : 'none';

  // New episode (or hasNext flip): re-arm everything.
  useEffect(() => {
    dismissedRef.current = false;
    firedRef.current = false;
    prevTimeRef.current = 0;
    setStartedAt(null);
    setCountdownVisible(false);
    return () => {
      setCountdownVisible(false);
    };
  }, [outroKey, hasNext]);

  // Arm when the playhead crosses into the first seconds of the outro.
  // Seeking far past the window (or starting inside it) never triggers —
  // the countdown only fires on arrival, and X/the advance consumes it.
  useEffect(() => {
    if (!outro || !hasNext) return;
    const prev = prevTimeRef.current;
    prevTimeRef.current = currentTime;
    if (currentTime < outro.from - 1) {
      dismissedRef.current = false;
      firedRef.current = false;
      if (startedAt !== null) {
        setStartedAt(null);
        setCountdownVisible(false);
      }
      return;
    }
    if (dismissedRef.current || firedRef.current || startedAt !== null) return;
    if (
      prev < outro.from &&
      currentTime >= outro.from &&
      currentTime - outro.from <= COUNTDOWN_SECONDS
    ) {
      setStartedAt(currentTime);
      setCountdownVisible(true);
    }
  }, [currentTime, outro, hasNext, startedAt]);

  // Fire exactly once when the countdown runs out. currentTime only moves
  // while playing, so pausing freezes the countdown for free.
  useEffect(() => {
    if (startedAt === null || firedRef.current) return;
    if (COUNTDOWN_SECONDS - (currentTime - startedAt) <= 0) {
      firedRef.current = true;
      setCountdownVisible(false);
      postToParent('next');
    }
  }, [currentTime, startedAt]);

  if (startedAt === null) return null;
  const remaining = Math.max(0, Math.ceil(COUNTDOWN_SECONDS - (currentTime - startedAt)));

  return (
    <div className="next-countdown" role="group" aria-label="Sonraki bölüm geri sayımı">
      <button
        className="next-countdown-cancel"
        aria-label="Geri sayımı iptal et"
        onClick={() => {
          dismissedRef.current = true;
          setStartedAt(null);
          setCountdownVisible(false);
        }}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
        </svg>
      </button>
      <button
        className="next-countdown-pill"
        aria-label="Sonraki bölüme geç"
        onClick={() => {
          firedRef.current = true;
          setStartedAt(null);
          setCountdownVisible(false);
          postToParent('next');
        }}
      >
        <span className="next-countdown-fill" style={{ width: `${(remaining / COUNTDOWN_SECONDS) * 100}%` }} />
        <span className="next-countdown-label">{remaining} Saniye içinde sonraki bölüm</span>
        <svg
          className="next-countdown-icon"
          viewBox="0 0 24 24"
          fill="currentColor"
          width="20"
          height="20"
          aria-hidden="true"
        >
          <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
        </svg>
      </button>
    </div>
  );
}
