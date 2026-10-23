import { useMediaContext, useMediaState } from '@vidstack/react';
import { OdometerIcon } from '@vidstack/react/icons';
import { SettingsRadioGroup, SidePanel, SubmenuTrigger, t } from './GlassMenu';

// The range form's fields are optional because the expansion below supplies
// defaults for each of them.
type PlaybackRates = number[] | { min?: number; max?: number; step?: number };

/**
 * The speeds offered in the Hız submenu — curated short list.
 */
export const PLAYBACK_RATES = [0.25, 0.5, 1, 1.25, 1.5, 2, 2.5, 4];

/**
 * Resolves the discrete selectable speeds from the layout playbackRates config.
 * Arrays are used verbatim; { min, max, step } ranges are expanded into a list.
 */
export function getSpeedOptions(rates: PlaybackRates | undefined): number[] {
  // The layout context types playbackRates as optional; falling back to the
  // configured list keeps the menu from rendering empty if it is ever missing.
  if (!rates) return PLAYBACK_RATES;
  if (Array.isArray(rates)) return rates;
  const { min = 0, max = 2, step = 0.25 } = rates;
  const options: number[] = [];
  for (let rate = min; rate <= max + 1e-9; rate += step) {
    options.push(Math.round(rate * 100) / 100);
  }
  return options;
}

/**
 * Formats the playback rate for display ("1.5x"), rounding away float noise
 * (e.g. 1.7500000000000002 → "1.75x"). 1x is shown as "Normal".
 */
export function formatSpeedValue(playbackRate: number, normalWord: string): string {
  if (playbackRate === 1) return normalWord;
  const rounded = Math.round(playbackRate * 100) / 100;
  return `${rounded}x`;
}

/**
 * SpeedMenu -- "Hız" submenu with a discrete playback-rate radio list.
 *
 * WHY: A slider bound to the playbackRates range allowed arbitrary
 * intermediate values that made playback feel unstable. The user settled on
 * exactly the presets defined by the layout playbackRates prop; a radio group
 * bound to the media playbackRate keeps the checked option in sync.
 */
export function SpeedMenu() {
  const { remote } = useMediaContext();
  const canSetPlaybackRate = useMediaState('canSetPlaybackRate');
  const playbackRate = useMediaState('playbackRate');
  const speedWord = t('Speed');
  const normalWord = t('Normal');

  if (!canSetPlaybackRate) return null;

  const options = getSpeedOptions(PLAYBACK_RATES);
  const valueLabel = formatSpeedValue(playbackRate, normalWord);

  return (
    <>
      <SubmenuTrigger id="speed" label={speedWord} hint={valueLabel} Icon={OdometerIcon} />
      <SidePanel id="speed" lift={20}>
        <SettingsRadioGroup
          value={String(playbackRate)}
          options={options.map((rate) => ({
            label: formatSpeedValue(rate, normalWord),
            value: String(rate),
          }))}
          onChange={(value) => remote.changePlaybackRate(parseFloat(value))}
        />
      </SidePanel>
    </>
  );
}
