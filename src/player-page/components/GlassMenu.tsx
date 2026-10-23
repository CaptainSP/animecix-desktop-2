import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Menu, Slider } from '@vidstack/react';
import { CheckIcon } from '@vidstack/react/icons';
import { turkishTranslations } from './translations';

/** Typed lookup into the Turkish translation map (replaces useDefaultLayoutWord). */
export function t(word: keyof typeof turkishTranslations): string {
  return turkishTranslations[word];
}

/* ── Submenu state (owned by React, not Vidstack) ────────────────
   The settings panel owns which side box is open; triggers toggle it and
   anything outside both boxes closes it. This replaces nested Vidstack
   submenu roots, whose open/close proved unreliable here. */

const SubmenuContext = createContext<{
  active: string | null;
  toggle: (id: string) => void;
  close: () => void;
}>({ active: null, toggle: () => {}, close: () => {} });

export function useSubmenu() {
  return useContext(SubmenuContext);
}

export function SubmenuProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<string | null>(null);

  const toggle = useCallback((id: string) => {
    setActive((current) => (current === id ? null : id));
  }, []);

  const close = useCallback(() => setActive(null), []);

  // The side box lives portaled OUTSIDE Menu.Items, so the root's own
  // display:none cannot hide it. Close it on every root-menu close — gear
  // presses are already covered by the pointerdown guard below, but
  // keyboard (Escape) and programmatic closes never produce one. Vidstack
  // dispatches open/close CustomEvents on the Menu.Root host (.glass-settings).
  useEffect(() => {
    const root = document.querySelector('.glass-settings');
    if (!root) return;
    const onMenuClose = () => close();
    root.addEventListener('close', onMenuClose);
    return () => root.removeEventListener('close', onMenuClose);
  }, [close]);

  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      // Inside either box only — the side panel is PORTALED into
      // .glass-menu-dock (it left the root panel so its blur can sample
      // the video), so the root panel's own class no longer covers it.
      // The gear/star pill buttons are DELIBERATELY not exempt: a gear
      // press toggles the root menu closed, and a star press opens the
      // enhancement panel — in both cases an open side box must go away
      // too (it lives outside Menu.Items, so the root's display:none
      // would otherwise leave it floating orphaned/overlapping).
      if (target?.closest('.glass-menu-items, .glass-menu-dock')) return;
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [active, close]);

  return (
    <SubmenuContext.Provider value={{ active, toggle, close }}>
      {children}
    </SubmenuContext.Provider>
  );
}

interface SubmenuTriggerProps {
  id: string;
  label: string;
  hint?: string;
  Icon?: React.ComponentType<{ className?: string }>;
}

/** Row that opens/closes its side box. */
export function SubmenuTrigger({ id, label, hint, Icon }: SubmenuTriggerProps) {
  const { active, toggle } = useSubmenu();
  const open = active === id;
  return (
    <button
      className="vds-menu-item"
      aria-expanded={open}
      aria-label={label}
      onClick={() => toggle(id)}
    >
      {Icon && <Icon className="vds-menu-item-icon vds-icon" />}
      <div className="vds-menu-item-label">{label}</div>
      {hint && <div className="vds-menu-item-hint">{hint}</div>}
    </button>
  );
}

/** Side box rendering the active section's options. Mounted only when open.
 * `lift` extends the box upward past the root top (px) while the bottom
 * stays glued to the root bottom.
 *
 * The box is PORTALED into .glass-menu-dock, a filter-free sibling of the
 * root menu box: the root box's own backdrop-filter would otherwise be this
 * panel's backdrop root, and the panel's blur would sample nothing but the
 * menu's dark background (measured 0.00% pixel delta when toggled). The
 * dock's box equals the menu's box, so the positioning CSS (right:
 * calc(100% + 10px), top/bottom: 0) resolves exactly as it did when the
 * panel was a child of the menu — the portal only changes WHO the backdrop
 * root is, not the geometry. */
export function SidePanel({ id, lift = 0, children }: { id: string; lift?: number; children: React.ReactNode }) {
  const { active } = useSubmenu();
  if (active !== id) return null;
  const box = (
    <div className="vds-menu-items vds-side-submenu" role="menu" style={lift ? { top: -lift } : undefined}>
      {children}
    </div>
  );
  const dock = typeof document !== 'undefined' ? document.querySelector<HTMLElement>('.glass-menu-dock') : null;
  return dock ? createPortal(box, dock) : box;
}

interface RadioGroupProps {
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}

/** Radio list used by the Kalite / Hız / Altyazılar submenus. */
export function SettingsRadioGroup({ value, options, onChange }: RadioGroupProps) {
  return (
    <Menu.RadioGroup className="vds-radio-group" role="radiogroup" value={value}>
      {options.map((option) => (
        <Menu.Radio
          className="vds-radio"
          value={option.value}
          onSelect={() => onChange(option.value)}
          key={option.value}
        >
          <CheckIcon className="vds-icon" />
          <span className="vds-radio-label">{option.label}</span>
        </Menu.Radio>
      ))}
    </Menu.RadioGroup>
  );
}

interface CheckboxProps {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  storageKey: string;
  defaultChecked?: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * Flat toggle row (Döngü / Duyurular / Klavye Animasyonları). Persists to
 * localStorage under the given key, mirroring DefaultMenuCheckbox behaviour.
 */
export function SettingsCheckbox({ label, Icon, storageKey, defaultChecked, onChange }: CheckboxProps) {
  const [checked, setChecked] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved != null ? saved === 'true' : !!defaultChecked;
    } catch {
      return !!defaultChecked;
    }
  });

  const toggle = () => {
    const next = !checked;
    setChecked(next);
    try {
      localStorage.setItem(storageKey, String(next));
    } catch {
      // Storage unavailable (private mode) — the toggle still works in-memory.
    }
    onChange(next);
  };

  return (
    <div className="vds-menu-item" role="menuitemcheckbox" aria-checked={checked} onClick={toggle}>
      <Icon className="vds-menu-item-icon vds-icon" />
      <div className="vds-menu-item-label">{label}</div>
      <button
        className={`glass-switch${checked ? ' on' : ''}`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        <span className="glass-switch-thumb" />
      </button>
    </div>
  );
}

/** Section header grouping rows inside the Altyazı Tarzları panel. */
export function SettingsSection({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="vds-menu-section">
      {label && <div className="vds-menu-section-label">{label}</div>}
      {children}
    </div>
  );
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}

/** Slider row for the font-size / opacity controls. */
export function SettingsSliderRow({ label, value, min, max, step, display, onChange }: SliderRowProps) {
  return (
    <div className="vds-menu-item vds-slider-item">
      <div className="vds-menu-item-label">{label}</div>
      <div className="vds-menu-item-hint">{display}</div>
      <Slider.Root
        className="vds-slider glass-mini-slider"
        min={min}
        max={max}
        step={step}
        keyStep={step}
        value={value}
        aria-label={label}
        onValueChange={(newValue) => onChange(newValue)}
        onDragValueChange={(newValue) => onChange(newValue)}
      >
        <Slider.Track className="vds-slider-track">
          <Slider.TrackFill className="vds-slider-track-fill vds-slider-track" />
        </Slider.Track>
        <Slider.Thumb className="vds-slider-thumb" />
      </Slider.Root>
    </div>
  );
}
