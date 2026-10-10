import { useSyncExternalStore } from 'react';
import { useMediaPlayer, useMediaState } from '@vidstack/react';
import type { SkipMeta } from '../types';
import { getCountdownVisible, subscribeCountdown } from './NextCountdown';

interface SkipButtonProps {
  meta: SkipMeta | null;
}

export function SkipButton({ meta }: SkipButtonProps) {
  const player = useMediaPlayer();
  const currentTime = useMediaState('currentTime');
  // The outro countdown owns the outro while visible — stand down so the
  // two never stack on the same corner.
  const countdownActive = useSyncExternalStore(subscribeCountdown, getCountdownVisible);

  if (!meta || !player || countdownActive) return null;

  let targetTime: number | null = null;

  for (const key of Object.keys(meta)) {
    if (key === 'music') continue;
    const data = meta[key] as { from: number; to: number } | undefined;
    if (data && 'from' in data && currentTime > data.from && currentTime < data.to) {
      targetTime = data.to;
      break;
    }
  }

  if (targetTime === null) return null;

  const skipTo = targetTime;

  return (
    <button
      className="skip"
      aria-label="Bu kismi atla"
      onClick={() => {
        player.currentTime = skipTo;
        player.play().catch(() => {});
      }}
    >
      Bu Kısmı Atla
    </button>
  );
}
