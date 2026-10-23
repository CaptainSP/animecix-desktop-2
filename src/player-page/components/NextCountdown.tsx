import { useEffect, useRef, useState } from 'react';
import { useMediaState } from '@vidstack/react';
import type { SkipMeta } from '../types';
import { postToParent } from '../hooks/useParentMessages';

/* Minimal external store so SkipButton can stand down while the prompt
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

/**
 * Guards against nonsense outro markers (wrong API data): an outro must
 * start after halftime and cover less than 40% of the episode. Unknown
 * duration never hides — only positively absurd ranges are rejected.
 */
export function isPlausibleOutro(from: number, to: number, duration: number): boolean {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
  if (from <= 0 || to <= from) return false;
  if (!Number.isFinite(duration) || duration <= 0) return true;
  return from / duration > 0.5 && (to - from) / duration < 0.4;
}

interface Props {
  meta: SkipMeta | null;
  hasNext: boolean;
}

/**
 * "Sonraki Bölüme Geç" prompt shown during the outro (no auto-advance, no
 * timer): the pill jumps to the next episode on click, X dismisses it for
 * this outro pass. Appears whenever the playhead is inside the outro range
 * with a next episode available.
 */
export function NextCountdown({ meta, hasNext }: Props) {
  const currentTime = useMediaState('currentTime');
  const duration = useMediaState('duration');
  const [visible, setVisible] = useState(false);
  const dismissedRef = useRef(false);
  const firedRef = useRef(false);

  const raw = meta?.outro;
  const outro =
    raw && 'from' in raw && typeof raw.from === 'number' && typeof raw.to === 'number'
      ? { from: raw.from, to: raw.to }
      : null;
  const outroKey = outro ? `${outro.from}-${outro.to}` : 'none';
  // Absurd API ranges never surface (see isPlausibleOutro).
  const saneOutro = outro && isPlausibleOutro(outro.from, outro.to, duration) ? outro : null;

  // New episode (or hasNext flip): re-arm everything.
  useEffect(() => {
    dismissedRef.current = false;
    firedRef.current = false;
    setVisible(false);
    setCountdownVisible(false);
    return () => {
      setCountdownVisible(false);
    };
  }, [outroKey, hasNext]);

  // Show while inside the outro zone; leaving it backward hides and re-arms
  // so coming back shows the prompt again.
  useEffect(() => {
    if (!saneOutro || !hasNext) return;
    if (currentTime < saneOutro.from - 1) {
      dismissedRef.current = false;
      firedRef.current = false;
      if (visible) {
        setVisible(false);
        setCountdownVisible(false);
      }
      return;
    }
    if (dismissedRef.current || firedRef.current || visible) return;
    if (currentTime >= saneOutro.from) {
      setVisible(true);
      setCountdownVisible(true);
    }
  }, [currentTime, saneOutro, hasNext, visible]);

  if (!visible) return null;

  return (
    <div className="next-countdown" role="group" aria-label="Sonraki bölüme geç">
      <button
        className="next-countdown-cancel"
        aria-label="Kapat"
        onClick={() => {
          dismissedRef.current = true;
          setVisible(false);
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
          setVisible(false);
          setCountdownVisible(false);
          postToParent('next');
        }}
      >
        <span className="next-countdown-label">Sonraki Bölüme Geç</span>
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
