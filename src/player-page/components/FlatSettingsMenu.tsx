import { useMediaContext, useMediaState } from '@vidstack/react';
import { RepeatIcon, SettingsSwitchIcon, VolumeHighIcon } from '@vidstack/react/icons';
import { SettingsCheckbox, t } from './GlassMenu';

/**
 * Flat checkbox items at the TOP LEVEL of the settings menu (same rows as
 * before: Döngü / Duyurular / Klavye Animasyonları).
 *
 * Announcements is a controlled row: GlassControls owns the preference (it
 * mounts <MediaAnnouncer> from it) and passes it down. Loop and keyboard
 * animations persist via SettingsCheckbox under the same storage keys the
 * default layout used.
 */

function LoopCheckbox() {
  const { remote } = useMediaContext();
  const label = t('Loop');

  return (
    <SettingsCheckbox
      label={label}
      Icon={RepeatIcon}
      storageKey="vds-player::user-loop"
      onChange={(checked) => remote.userPrefersLoopChange(checked)}
    />
  );
}

interface AnnouncementsCheckboxProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

function AnnouncementsCheckbox({ enabled, onChange }: AnnouncementsCheckboxProps) {
  const label = t('Announcements');

  return (
    <div
      className="vds-menu-item"
      role="menuitemcheckbox"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
    >
      <VolumeHighIcon className="vds-menu-item-icon vds-icon" />
      <div className="vds-menu-item-label">{label}</div>
      <button
        className={`glass-switch${enabled ? ' on' : ''}`}
        role="switch"
        aria-checked={enabled}
        aria-label={label}
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          onChange(!enabled);
        }}
      >
        <span className="glass-switch-thumb" />
      </button>
    </div>
  );
}

function KeyboardAnimationsCheckbox() {
  const viewType = useMediaState('viewType');
  const label = t('Keyboard Animations');

  if (viewType !== 'video') return null;

  return (
    <SettingsCheckbox
      label={label}
      Icon={SettingsSwitchIcon}
      storageKey="vds-player::keyboard-animations"
      defaultChecked
      onChange={() => {}}
    />
  );
}

interface FlatSettingsMenuProps {
  announcements: boolean;
  onAnnouncementsChange: (enabled: boolean) => void;
}

/** All flat checkbox items — rendered together at the settings menu top. */
export function FlatSettingsMenu({ announcements, onAnnouncementsChange }: FlatSettingsMenuProps) {
  return (
    <>
      <LoopCheckbox />
      <AnnouncementsCheckbox enabled={announcements} onChange={onAnnouncementsChange} />
      <KeyboardAnimationsCheckbox />
    </>
  );
}
