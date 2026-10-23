import { useEffect, useState } from 'react';
import { useMediaPlayer, useMediaState } from '@vidstack/react';
import { SubtitlesIcon } from '@vidstack/react/icons';
import {
  SettingsRadioGroup,
  SettingsSection,
  SettingsSliderRow,
  SidePanel,
  SubmenuTrigger,
  t,
} from './GlassMenu';
import { turkishTranslations } from './translations';

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

type TranslatableLabel = keyof typeof turkishTranslations;

/**
 * Array.isArray narrows to `any[]`, which does not remove `readonly string[]`
 * from the union in the else branch — hence an explicit predicate.
 */
function isLabelList(
  values: Record<string, string> | readonly string[]
): values is readonly string[] {
  return Array.isArray(values);
}

/** Radio section expanding inline (e.g. font family, text shadow). */
function FontRadioControl({
  type,
  label,
  values,
  settings,
  update,
}: FontControlProps & {
  type: FontSettingType;
  label: TranslatableLabel;
  // readonly, because the option lists are declared `as const`.
  values: Record<string, string> | readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const hint = t(label);
  const options = isLabelList(values)
    ? values.map((entry) => ({ label: entry, value: entry.toLowerCase() }))
    : Object.entries(values).map(([entryLabel, value]) => ({ label: entryLabel, value }));
  const current = settings[type];
  const currentLabel = options.find((option) => option.value === current)?.label ?? current;

  return (
    <>
      <button className="vds-menu-item" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        <div className="vds-menu-item-label">{hint}</div>
        <div className="vds-menu-item-hint">{currentLabel}</div>
      </button>
      {open && (
        <SettingsRadioGroup
          value={current}
          options={options}
          onChange={(value) => update(type, value)}
        />
      )}
    </>
  );
}

/** Color picker row. */
function FontColorControl({
  type,
  label,
  settings,
  update,
}: FontControlProps & { type: FontSettingType; label: TranslatableLabel }) {
  const translated = t(label);
  return (
    <div className="vds-menu-item" role="menuitem">
      <div className="vds-menu-item-label">{translated}</div>
      <input
        className="vds-color-picker glass-color-picker"
        type="color"
        value={settings[type]}
        aria-label={translated}
        onChange={(event) => update(type, event.target.value)}
      />
    </div>
  );
}

/** Slider row (font size, opacity). */
function FontSliderControl({
  type,
  label,
  min,
  max,
  step,
  settings,
  update,
}: FontControlProps & {
  type: FontSettingType;
  label: TranslatableLabel;
  min: number;
  max: number;
  step: number;
}) {
  const translated = t(label);
  const value = settings[type];

  return (
    <SettingsSliderRow
      label={translated}
      value={parseInt(value, 10)}
      min={min}
      max={max}
      step={step}
      display={value}
      onChange={(newValue) => update(type, `${newValue}%`)}
    />
  );
}

/** Reset button — restores every font setting to its default. */
function FontResetItem({ reset }: { reset: () => void }) {
  const label = t('Reset');
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
  const { settings, update, reset } = useFontSettings();

  if (!hasCaptions) return null;

  const label = t('Caption Styles');
  const fontLabel = t('Font');
  const textLabel = t('Text');
  const textBgLabel = t('Text Background');
  const displayBgLabel = t('Display Background');

  return (
    <>
      <SubmenuTrigger id="caption-styles" label={label} Icon={SubtitlesIcon} />
      <SidePanel id="caption-styles">
        <SettingsSection label={fontLabel}>
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
            settings={settings}
            update={update}
          />
        </SettingsSection>
        <SettingsSection label={textLabel}>
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
            settings={settings}
            update={update}
          />
        </SettingsSection>
        <SettingsSection label={textBgLabel}>
          <FontColorControl type="textBg" label="Color" settings={settings} update={update} />
          <FontSliderControl
            type="textBgOpacity"
            label="Opacity"
            {...FONT_OPACITY_OPTION}
            settings={settings}
            update={update}
          />
        </SettingsSection>
        <SettingsSection label={displayBgLabel}>
          <FontColorControl type="displayBg" label="Color" settings={settings} update={update} />
          <FontSliderControl
            type="displayBgOpacity"
            label="Opacity"
            {...FONT_OPACITY_OPTION}
            settings={settings}
            update={update}
          />
        </SettingsSection>
        <SettingsSection>
          <FontResetItem reset={reset} />
        </SettingsSection>
      </SidePanel>
    </>
  );
}
