import { Menu, useMediaContext, useMediaState } from '@vidstack/react';
import { ComputerIcon } from '@vidstack/react/icons';
import {
  DefaultMenuButton,
  DefaultMenuRadioGroup,
  useDefaultLayoutWord,
} from '@vidstack/react/player/layouts/default';

interface QualityLike {
  height?: number;
}

/**
 * Builds the radio options for the quality menu: "Otomatik" first, then all
 * available qualities sorted from highest to lowest (1080p → 480p).
 */
export function buildQualityOptions<T extends QualityLike>(
  qualities: readonly T[],
  autoWord: string,
): { label: string; value: string }[] {
  const sorted = [...qualities].sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  return [
    { label: autoWord, value: 'auto' },
    ...sorted
      .filter((q) => q.height != null)
      .map((q) => ({ label: `${q.height}p`, value: String(q.height) })),
  ];
}

/**
 * Resolves the current radio value for the given player state.
 * Auto quality → 'auto'; otherwise the height of the selected quality.
 */
export function resolveQualityValue(
  autoQuality: boolean,
  selectedQuality: QualityLike | null,
): string {
  if (autoQuality || !selectedQuality?.height) return 'auto';
  return String(selectedQuality.height);
}

/**
 * Resolves the provider-list index for a selected radio value.
 * changeQuality expects the index in the provider's original quality list,
 * NOT the sorted display order.
 */
export function findQualityIndex<T extends QualityLike>(
  qualities: readonly T[],
  value: string,
): number {
  return qualities.findIndex((q) => String(q.height) === value);
}

/**
 * QualityMenu -- quality selector nested inside the "Hız ve Kalite" (Playback)
 * menu as a submenu button, matching the "Altyazı Tarzları" (Caption Styles)
 * pattern from the default layout.
 *
 * WHY: The default layout renders quality selection as a slider inside the
 * playback menu, which is unintuitive on desktop. This component replaces it
 * with a "Kalite" menu button that opens a side panel listing explicit quality
 * options (Otomatik / 1080p / 720p / 480p). The default quality slider section
 * is hidden via CSS (see EmbedPlayer.css -- .vds-quality-slider section).
 *
 * When quality cannot be changed (live streams, single-quality sources, or
 * providers without quality control), the whole submenu is hidden.
 */
export function QualityMenu() {
  const { remote } = useMediaContext();
  const canSetQuality = useMediaState('canSetQuality');
  const qualities = useMediaState('qualities');
  const quality = useMediaState('quality');
  const autoQuality = useMediaState('autoQuality');
  const qualityWord = useDefaultLayoutWord('Quality');
  const autoWord = useDefaultLayoutWord('Auto');

  // If the source has no selectable qualities or quality switching is not
  // supported, hide the entire submenu ("kapalı görünsün").
  if (!canSetQuality || qualities.length <= 1) {
    return null;
  }

  const options = buildQualityOptions(qualities, autoWord);
  const currentValue = resolveQualityValue(autoQuality, quality);
  const currentLabel = currentValue === 'auto' ? autoWord : `${currentValue}p`;

  const onSelect = (value: string) => {
    if (value === 'auto') {
      remote.requestAutoQuality();
      return;
    }
    const index = findQualityIndex(qualities, value);
    if (index >= 0) {
      remote.changeQuality(index);
    }
  };

  return (
    <Menu.Root className="vds-menu">
      <DefaultMenuButton label={qualityWord} hint={currentLabel} Icon={ComputerIcon} />
      <Menu.Items className="vds-menu-items vds-quick-submenu">
        <DefaultMenuRadioGroup value={currentValue} options={options} onChange={onSelect} />
      </Menu.Items>
    </Menu.Root>
  );
}
