import { Menu, useCaptionOptions } from '@vidstack/react';
import {
  DefaultMenuButton,
  useDefaultLayoutContext,
  useDefaultLayoutWord,
} from '@vidstack/react/player/layouts/default';

/**
 * CaptionsMenu -- "Altyazılar" submenu for selecting the active caption track.
 *
 * WHY: The default DefaultCaptionMenu is hidden via CSS (EmbedPlayer.css) and
 * recreated here as a flat top-level item using the public useCaptionOptions
 * hook. Renders "Kapalı" (Off) plus one radio per available caption track.
 */
export function CaptionsMenu() {
  const { icons } = useDefaultLayoutContext();
  const label = useDefaultLayoutWord('Captions');
  const offText = useDefaultLayoutWord('Off');
  const options = useCaptionOptions({ off: offText });
  const hint = options.selectedTrack?.label ?? offText;

  if (options.disabled) return null;

  return (
    <Menu.Root className="vds-menu">
      <DefaultMenuButton label={label} hint={hint} Icon={icons.Menu.Captions} />
      <Menu.Items className="vds-menu-items vds-quick-submenu">
        {/* WHY RadioGroup: bare Menu.Radio children have no radioControllerContext
            ancestor, so mount throws "Cannot read properties of undefined (reading 'add')". */}
        <Menu.RadioGroup className="vds-radio-group" role="radiogroup" value={options.selectedValue}>
          {options.map(({ label: optionLabel, value, select }) => (
            <Menu.Radio className="vds-radio" value={value} onSelect={select} key={value}>
              <icons.Menu.RadioCheck className="vds-icon" />
              <span className="vds-radio-label">{optionLabel}</span>
            </Menu.Radio>
          ))}
        </Menu.RadioGroup>
      </Menu.Items>
    </Menu.Root>
  );
}
