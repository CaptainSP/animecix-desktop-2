import { useEffect, useState } from 'react';
import { Menu, Slider, useMediaPlayer, useMediaState } from '@vidstack/react';
import { SubtitlesIcon } from '@vidstack/react/icons';
import {
  DefaultMenuButton,
  DefaultMenuItem,
  DefaultMenuRadioGroup,
  DefaultMenuSection,
  DefaultMenuSliderItem,
  DefaultSliderParts,
  DefaultSliderSteps,
  type DefaultLayoutIcon,
  useDefaultLayoutContext,
  useDefaultLayoutWord,
} from '@vidstack/react/player/layouts/default';

/**
 * CaptionStylesMenu -- "Altyazı Tarzları" submenu rebuilt from scratch.
 *
 * WHY: The default DefaultFontMenu is NOT exported from the public Vidstack
 * API, yet it holds all the caption styling controls. This component mirrors
 * its behaviour using only public primitives: values are persisted to
 * localStorage ("vds-player:<kebab-key>") and applied to the player element
 * as --media-user-* CSS variables, exactly like the built-in implementation.
 */

const FONT_FAMILY_OPTION = {
  type: 'radio',
  values: {
    'Monospaced Serif': 'mono-serif',
    'Proportional Serif': 'pro-serif',
    'Monospaced Sans-Serif': 'mono-sans',
    'Proportional Sans-Serif': 'pro-sans',
    Casual: 'casual',
    Cursive: 'cursive',
    'Small Capitals': 'capitals',
  },
} as const;

const FONT_SIZE_OPTION = { min: 0, max: 400, step: 25 } as const;

const FONT_OPACITY_OPTION = { min: 0, max: 100, step: 5 } as const;

const FONT_TEXT_SHADOW_OPTION = {
  type: 'radio',
  values: ['None', 'Drop Shadow', 'Raised', 'Depressed', 'Outline'],
} as const;

export const FONT_DEFAULTS = {
  fontFamily: 'pro-sans',
  fontSize: '100%',
  textColor: '#ffffff',
  textOpacity: '100%',
  textShadow: 'none',
  textBg: '#000000',
  textBgOpacity: '100%',
  displayBg: '#000000',
  displayBgOpacity: '0%',
} as const;

type FontSettingType = keyof typeof FONT_DEFAULTS;
type FontSettings = Record<FontSettingType, string>;

/** "textBgOpacity" -> "text-bg-opacity" (matches Vidstack storage/CSS var keys). */
export function camelToKebabCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** Converts a hex color (#rgb or #rrggbb) to "r g b" triple (used inside rgb(... / opacity)). */
export function hexToRgb(hex: string): string {
  let value = hex.replace('#', '');
  if (value.length === 3) {
    value = value
      .split('')
      .map((char) => char + char)
      .join('');
  }
  const number = parseInt(value, 16);
  if (Number.isNaN(number) || value.length !== 6) return '';
  return `${(number >> 16) & 255} ${(number >> 8) & 255} ${number & 255}`;
}

/** Converts a percentage string ("100%") to a ratio ("1"). */
export function percentToRatio(value: string): string {
  return (parseInt(value, 10) / 100).toString();
}

export function fontFamilyCSSVarValue(value: string): string {
  switch (value) {
    case 'mono-serif':
      return '"Courier New", Courier, "Nimbus Mono L", "Cutive Mono", monospace';
    case 'mono-sans':
      return '"Deja Vu Sans Mono", "Lucida Console", Monaco, Consolas, "PT Mono", monospace';
    case 'pro-sans':
      return 'Roboto, "Arial Unicode Ms", Arial, Helvetica, Verdana, "PT Sans Caption", sans-serif';
    case 'casual':
      return '"Comic Sans MS", Impact, Handlee, fantasy';
    case 'cursive':
      return '"Monotype Corsiva", "URW Chancery L", "Apple Chancery", "Dancing Script", cursive';
    case 'capitals':
      return '"Arial Unicode Ms", Arial, Helvetica, Verdana, "Marcellus SC", sans-serif';
    default:
      return '"Times New Roman", Times, Georgia, Cambria, "PT Serif Caption", serif';
  }
}

export function textShadowCSSVarValue(value: string): string {
  switch (value) {
    case 'drop shadow':
      return 'rgb(34, 34, 34) 1.86389px 1.86389px 2.79583px, rgb(34, 34, 34) 1.86389px 1.86389px 3.72778px, rgb(34, 34, 34) 1.86389px 1.86389px 4.65972px';
    case 'raised':
      return 'rgb(34, 34, 34) 1px 1px, rgb(34, 34, 34) 2px 2px';
    case 'depressed':
      return 'rgb(204, 204, 204) 1px 1px, rgb(34, 34, 34) -1px -1px';
    case 'outline':
      return 'rgb(34, 34, 34) 0px 0px 1.86389px, rgb(34, 34, 34) 0px 0px 1.86389px, rgb(34, 34, 34) 0px 0px 1.86389px, rgb(34, 34, 34) 0px 0px 1.86389px, rgb(34, 34, 34) 0px 0px 1.86389px';
    default:
      return '';
  }
}

function getCssVarValue(type: FontSettingType, value: string, el: HTMLElement): string {
  switch (type) {
    case 'fontFamily': {
      // Small-capitals font needs a separate font-variant hint.
      el.style.setProperty('--media-user-font-variant', value === 'capitals' ? 'small-caps' : '');
      return fontFamilyCSSVarValue(value);
    }
    case 'fontSize':
    case 'textOpacity':
    case 'textBgOpacity':
    case 'displayBgOpacity':
      return percentToRatio(value);
    case 'textColor':
      return `rgb(${hexToRgb(value)} / var(--media-user-text-opacity, 1))`;
    case 'textShadow':
      return textShadowCSSVarValue(value);
    case 'textBg':
      return `rgb(${hexToRgb(value)} / var(--media-user-text-bg-opacity, 1))`;
    case 'displayBg':
      return `rgb(${hexToRgb(value)} / var(--media-user-display-bg-opacity, 1))`;
  }
}

/**
 * Loads all font settings from localStorage, seeding any missing keys with
 * their defaults. Keys mirror Vidstack: "vds-player:<kebab-case>".
 */
function loadFontSettings(): FontSettings {
  // Annotated rather than inferred: FONT_DEFAULTS is `as const`, so spreading it
  // gives each key its literal type and the assignment below (a plain string
  // off localStorage) narrows to `never`.
  const settings: FontSettings = { ...FONT_DEFAULTS };
  for (const type of Object.keys(FONT_DEFAULTS) as FontSettingType[]) {
    const saved = localStorage.getItem(`vds-player:${camelToKebabCase(type)}`);
    if (saved != null) settings[type] = saved;
  }
  return settings;
}

/** State lifted to the menu root so all controls share one source of truth. */
function useFontSettings() {
  const player = useMediaPlayer();
  const [settings, setSettings] = useState<FontSettings>(loadFontSettings);

  useEffect(() => {
    const el = player?.el;
    if (!el) return;
    for (const type of Object.keys(settings) as FontSettingType[]) {
      const value = settings[type];
      const varName = `--media-user-${camelToKebabCase(type)}`;
      // Default values are applied by Vidstack's own stylesheet, so only
      // non-default values must be set (mirrors the built-in implementation).
      const varValue = value !== FONT_DEFAULTS[type] ? getCssVarValue(type, value, el) : null;
      el.style.setProperty(varName, varValue);
    }
  }, [player, settings]);

  const update = (type: FontSettingType, value: string) => {
    setSettings((prev) => {
      const next = { ...prev, [type]: value };
      if (value === FONT_DEFAULTS[type]) {
        localStorage.removeItem(`vds-player:${camelToKebabCase(type)}`);
      } else {
        localStorage.setItem(`vds-player:${camelToKebabCase(type)}`, value);
      }
      return next;
    });
  };

  const reset = () => {
    setSettings((prev) => {
      for (const type of Object.keys(prev) as FontSettingType[]) {
        localStorage.removeItem(`vds-player:${camelToKebabCase(type)}`);
      }
      return { ...FONT_DEFAULTS };
    });
  };

  return { settings, update, reset };
}

type FontControlProps = {
  settings: FontSettings;
  update: (type: FontSettingType, value: string) => void;
};

/**
 * Array.isArray narrows to `any[]`, which does not remove `readonly string[]`
 * from the union in the else branch — hence an explicit predicate.
 */
function isLabelList(
  values: Record<string, string> | readonly string[]
): values is readonly string[] {
  return Array.isArray(values);
}

/** Radio submenu (e.g. font family, text shadow). */
function FontRadioControl({
  type,
  label,
  values,
  settings,
  update,
}: FontControlProps & {
  type: FontSettingType;
  label: string;
  // readonly, because the option lists are declared `as const`.
  values: Record<string, string> | readonly string[];
}) {
  const hint = useDefaultLayoutWord(label);
  const options = isLabelList(values)
    ? values.map((entry) => ({ label: entry, value: entry.toLowerCase() }))
    : Object.entries(values).map(([entryLabel, value]) => ({ label: entryLabel, value }));
  const current = settings[type];
  const currentLabel = options.find((option) => option.value === current)?.label ?? current;

  return (
    <Menu.Root className="vds-menu">
      <DefaultMenuButton label={hint} hint={currentLabel} />
      <Menu.Items className="vds-menu-items vds-quick-submenu">
        <DefaultMenuRadioGroup
          value={current}
          options={options}
          onChange={(value) => update(type, value)}
        />
      </Menu.Items>
    </Menu.Root>
  );
}

/** Color picker row. */
function FontColorControl({
  type,
  label,
  settings,
  update,
}: FontControlProps & { type: FontSettingType; label: string }) {
  const translated = useDefaultLayoutWord(label);
  return (
    <DefaultMenuItem label={translated}>
      <input
        className="vds-color-picker"
        type="color"
        value={settings[type]}
        onChange={(event) => update(type, event.target.value)}
      />
    </DefaultMenuItem>
  );
}

/** Slider row (font size, opacity). */
function FontSliderControl({
  type,
  label,
  min,
  max,
  step,
  UpIcon,
  DownIcon,
  settings,
  update,
}: FontControlProps & {
  type: FontSettingType;
  label: string;
  min: number;
  max: number;
  step: number;
  // The exact type DefaultMenuSliderItem expects; the call sites pass
  // icons.Menu.FontSizeUp and friends, which are declared as DefaultLayoutIcon.
  UpIcon?: DefaultLayoutIcon;
  DownIcon?: DefaultLayoutIcon;
}) {
  const translated = useDefaultLayoutWord(label);
  const value = settings[type];

  return (
    <DefaultMenuSliderItem
      label={translated}
      value={value}
      UpIcon={UpIcon}
      DownIcon={DownIcon}
      isMin={value === `${min}%`}
      isMax={value === `${max}%`}
    >
      <Slider.Root
        className="vds-slider"
        min={min}
        max={max}
        step={step}
        keyStep={step}
        value={parseInt(value, 10)}
        aria-label={translated}
        onValueChange={(newValue) => update(type, `${newValue}%`)}
        onDragValueChange={(newValue) => update(type, `${newValue}%`)}
      >
        <DefaultSliderParts />
        <DefaultSliderSteps />
      </Slider.Root>
    </DefaultMenuSliderItem>
  );
}

/** Reset button — restores every font setting to its default. */
function FontResetItem({ reset }: { reset: () => void }) {
  const label = useDefaultLayoutWord('Reset');
  return (
    <button className="vds-menu-item" role="menuitem" onClick={reset}>
      <span className="vds-menu-item-label">{label}</span>
    </button>
  );
}

/**
 * "Altyazı Tarzları" submenu — shown only when the source has captions
 * (softsubs), matching the default DefaultFontMenu visibility rule.
 */
export function CaptionStylesMenu() {
  const hasCaptions = useMediaState('hasCaptions');
  const { icons } = useDefaultLayoutContext();
  const { settings, update, reset } = useFontSettings();

  if (!hasCaptions) return null;

  const label = useDefaultLayoutWord('Caption Styles');
  const fontLabel = useDefaultLayoutWord('Font');
  const textLabel = useDefaultLayoutWord('Text');
  const textBgLabel = useDefaultLayoutWord('Text Background');
  const displayBgLabel = useDefaultLayoutWord('Display Background');

  return (
    <Menu.Root className="vds-menu">
      <DefaultMenuButton label={label} Icon={SubtitlesIcon} />
      <Menu.Items className="vds-menu-items vds-font-style-items vds-quick-submenu">
        <DefaultMenuSection label={fontLabel}>
          <FontRadioControl
            type="fontFamily"
            label="Family"
            values={FONT_FAMILY_OPTION.values}
            settings={settings}
            update={update}
          />
          <FontSliderControl
            type="fontSize"
            label="Size"
            {...FONT_SIZE_OPTION}
            UpIcon={icons.Menu.FontSizeUp}
            DownIcon={icons.Menu.FontSizeDown}
            settings={settings}
            update={update}
          />
        </DefaultMenuSection>
        <DefaultMenuSection label={textLabel}>
          <FontColorControl type="textColor" label="Color" settings={settings} update={update} />
          <FontRadioControl
            type="textShadow"
            label="Shadow"
            values={FONT_TEXT_SHADOW_OPTION.values}
            settings={settings}
            update={update}
          />
          <FontSliderControl
            type="textOpacity"
            label="Opacity"
            {...FONT_OPACITY_OPTION}
            UpIcon={icons.Menu.OpacityUp}
            DownIcon={icons.Menu.OpacityDown}
            settings={settings}
            update={update}
          />
        </DefaultMenuSection>
        <DefaultMenuSection label={textBgLabel}>
          <FontColorControl type="textBg" label="Color" settings={settings} update={update} />
          <FontSliderControl
            type="textBgOpacity"
            label="Opacity"
            {...FONT_OPACITY_OPTION}
            UpIcon={icons.Menu.OpacityUp}
            DownIcon={icons.Menu.OpacityDown}
            settings={settings}
            update={update}
          />
        </DefaultMenuSection>
        <DefaultMenuSection label={displayBgLabel}>
          <FontColorControl type="displayBg" label="Color" settings={settings} update={update} />
          <FontSliderControl
            type="displayBgOpacity"
            label="Opacity"
            {...FONT_OPACITY_OPTION}
            UpIcon={icons.Menu.OpacityUp}
            DownIcon={icons.Menu.OpacityDown}
            settings={settings}
            update={update}
          />
        </DefaultMenuSection>
        <DefaultMenuSection>
          <FontResetItem reset={reset} />
        </DefaultMenuSection>
      </Menu.Items>
    </Menu.Root>
  );
}
