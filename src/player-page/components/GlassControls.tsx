import { useEffect, useRef, type ReactNode } from 'react';
import {
  Captions,
  Controls,
  FullscreenButton,
  MediaAnnouncer,
  Menu,
  MuteButton,
  PIPButton,
  PlayButton,
  Spinner,
  Time,
  TimeSlider,
  Title,
  VolumeSlider,
  useMediaContext,
  useMediaPlayer,
  useMediaState,
} from '@vidstack/react';
import {
  FullscreenExitIcon,
  FullscreenIcon,
  MuteIcon,
  PauseIcon,
  PictureInPictureExitIcon,
  PictureInPictureIcon,
  PlayIcon,
  ReplayIcon,
  SettingsIcon,
  VolumeHighIcon,
  VolumeLowIcon,
} from '@vidstack/react/icons';
import { CaptionStylesMenu } from './CaptionStylesMenu';
import { CaptionsMenu } from './CaptionsMenu';
import { EnhancementPanel } from './EnhancementPanel';
import type { UpscalePreset, ColorFilters, EnhancementStats } from '../hooks/useVideoEnhancement';
import { FlatSettingsMenu } from './FlatSettingsMenu';
import { QualityMenu } from './QualityMenu';
import { SpeedMenu } from './SpeedMenu';
import { SubmenuProvider, t } from './GlassMenu';
import { turkishTranslations } from './translations';
import './GlassControls.css';

interface GlassControlsProps {
  announcements: boolean;
  onAnnouncementsChange: (enabled: boolean) => void;
  enhancement: {
    preset: UpscalePreset;
    onPresetChange: (preset: UpscalePreset) => void;
    filters: ColorFilters;
    onFiltersChange: (filters: Partial<ColorFilters>) => void;
    stats: EnhancementStats;
    isActive: boolean;
    panelOpen: boolean;
    onPanelToggle: () => void;
  };
}

/**
 * Settings (gear) pill button + dropdown panel: flat toggles, Kalite, Hız,
 * Altyazılar, Altyazı Tarzları.
 *
 * WHY the pill sits INSIDE Menu.Root (and not the other way round): the
 * pill's `backdrop-filter` makes it a backdrop root, and a backdrop root
 * also clips what its descendants' own `backdrop-filter` can sample. With
 * Menu.Items nested inside the pill, the menu could only sample the pill's
 * own painting (nothing) and rendered a dead, sharp backdrop — measured at
 * a 0.00% pixel delta. Rendering the menu as a SIBLING of the pill puts it
 * outside that root so it samples the video again (58% of its pixels
 * change with the blur toggled), while the pill keeps its frosted look.
 *
 * WHY the dock wrapper around Menu.Items: the root menu box itself carries
 * a `backdrop-filter`, which would be the backdrop root for the side
 * submenus (Kalite / Hız / Altyazılar) rendered inside it — their own blur
 * sampled nothing but the menu's dark background (0.00% delta). The dock
 * is a filter-free sibling of the menu box; SidePanel portals its panel
 * into the dock, so the panel sits right next to the menu with no backdrop
 * root in between and samples the video again, while the CSS geometry
 * (right: calc(100% + 10), top/bottom: 0) resolves against the dock box,
 * which equals the menu box.
 *
 * `children` are the pill's other controls (PiP, enhancement, fullscreen);
 * they stay inside the pill for the shared capsule look but outside the
 * menu subtree.
 */
function SettingsMenu({
  announcements,
  onAnnouncementsChange,
  children,
}: {
  announcements: boolean;
  onAnnouncementsChange: (enabled: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <Menu.Root className="glass-settings">
      <div className="glass-pill" role="group" aria-label={t('Settings')}>
        <Menu.Button className="glass-btn" aria-label={t('Settings')} title={t('Settings')}>
          <SettingsIcon className="vds-icon" />
        </Menu.Button>
        {children}
      </div>
      <div className="glass-menu-dock">
        <Menu.Items className="vds-menu-items glass-menu-items" placement="top end" offset={4}>
          <SubmenuProvider>
            <FlatSettingsMenu announcements={announcements} onAnnouncementsChange={onAnnouncementsChange} />
            <QualityMenu />
            <SpeedMenu />
            <CaptionsMenu />
            <CaptionStylesMenu />
          </SubmenuProvider>
        </Menu.Items>
      </div>
    </Menu.Root>
  );
}

/** Anime + episode title next to the clock (set by the parent site). */
function GlassTitle() {
  const title = useMediaState('title');
  if (!title) return null;
  return <Title className="glass-title" />;
}

/** PiP pill button (design puts it in the right pill, next to settings). */
function GlassPipButton() {
  const canPiP = useMediaState('canPictureInPicture');
  const pip = useMediaState('pictureInPicture');
  if (!canPiP) return null;
  return (
    <PIPButton className="glass-btn" aria-label={pip ? t('Exit PiP') : t('Enter PiP')}>
      {pip ? (
        <PictureInPictureExitIcon className="vds-icon" />
      ) : (
        <PictureInPictureIcon className="vds-icon" />
      )}
    </PIPButton>
  );
}

function GlassPlayButton() {
  const paused = useMediaState('paused');
  const ended = useMediaState('ended');
  return (
    <PlayButton className="glass-btn glass-btn-play" aria-label={paused ? t('Play') : t('Pause')}>
      {ended ? (
        <ReplayIcon className="vds-icon" />
      ) : paused ? (
        <PlayIcon className="vds-icon" />
      ) : (
        <PauseIcon className="vds-icon" />
      )}
    </PlayButton>
  );
}

/** Live volume readout at the right end of the expanding volume slider.
 * Decorative (the slider itself carries the aria label); muted reads 0. */
function GlassVolumeValue() {
  const volume = useMediaState('volume');
  const muted = useMediaState('muted');
  const pct = muted ? 0 : Math.round(volume * 100);
  return (
    <div className="glass-volume-value" aria-hidden="true">
      <span>{pct}%</span>
    </div>
  );
}

function GlassMuteButton() {
  const muted = useMediaState('muted');
  const volume = useMediaState('volume');
  return (
    <MuteButton className="glass-btn" aria-label={muted ? t('Unmute') : t('Mute')}>
      {muted || volume === 0 ? (
        <MuteIcon className="vds-icon" />
      ) : volume < 0.5 ? (
        <VolumeLowIcon className="vds-icon" />
      ) : (
        <VolumeHighIcon className="vds-icon" />
      )}
    </MuteButton>
  );
}

function GlassFullscreenButton() {
  const fullscreen = useMediaState('fullscreen');
  return (
    <FullscreenButton
      className="glass-btn"
      aria-label={fullscreen ? t('Exit Fullscreen') : t('Enter Fullscreen')}
    >
      {fullscreen ? (
        <FullscreenExitIcon className="vds-icon" />
      ) : (
        <FullscreenIcon className="vds-icon" />
      )}
    </FullscreenButton>
  );
}

/** Keyboard shortcuts: Space/K play-pause, arrows seek ∓10s, F fullscreen, M mute. */
function useKeyboardShortcuts() {
  const player = useMediaPlayer();

  useEffect(() => {
    if (!player) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Let focused controls handle their own keys (otherwise Space on a
      // menu button would both toggle playback here AND activate the button,
      // and arrows on the sliders would seek twice).
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.tagName === 'BUTTON' ||
          target.closest?.(
            'button, [role="button"], [role="slider"], [role="menu"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="radiogroup"], a'
          ))
      ) {
        return;
      }

      switch (event.key) {
        case ' ':
        case 'k':
          event.preventDefault();
          if (player.state.paused) player.play().catch(() => {});
          else player.pause();
          break;
        case 'ArrowRight':
          event.preventDefault();
          player.currentTime = Math.min(player.state.duration || 0, player.state.currentTime + 10);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          player.currentTime = Math.max(0, player.state.currentTime - 10);
          break;
        case 'f':
          event.preventDefault();
          if (player.state.fullscreen) player.remote.exitFullscreen();
          else player.remote.requestFullscreen();
          break;
        case 'm':
          event.preventDefault();
          if (player.state.muted) player.remote.requestUnmute();
          else player.remote.requestMute();
          break;
        default:
          break;
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [player]);
}

/** Click zones on the video surface.
 *
 * WHY manual instead of Vidstack <Gesture event="pointerup">: hit-testing a
 * press lands on this container div, which the Gesture trigger does not
 * accept, so it never fires here. Toggle directly and ignore presses that
 * start on real controls. Double-click seeks ∓10s on the outer thirds and
 * toggles fullscreen in the middle third (entering also resumes: the two
 * pointerups of a double-click would otherwise leave a paused video
 * paused behind the fullscreen switch).
 */
function SeekGestures() {
  const player = useMediaPlayer();
  const { remote } = useMediaContext();
  const duration = useMediaState('duration');
  const fullscreen = useMediaState('fullscreen');
  // Snapshot at press start: the star panel closes itself on pointerdown
  // (its own outside handler), i.e. BEFORE pointerup — so a pointerup-time
  // query would miss it and the closing press would also toggle playback.
  const swallowRef = useRef(false);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const doc = event.currentTarget.ownerDocument;
    swallowRef.current = !!doc.querySelector(
      '.glass-menu-items[data-root][aria-hidden="false"], .ve-panel'
    );
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, [role="slider"], input, a, .glass-menu-items, .glass-menu-dock, .ve-panel')) return;
    // Swallow the toggle when this press closed an open menu or panel.
    // Vidstack closes the root menu on window pointerup, which runs AFTER
    // this React handler, so the press still counted at pointerdown time.
    // Without this, one click both closes the menu and pauses the video.
    // NOTE: vidstack does NOT put data-open on Menu.Root — verified live
    // (only data-root there), so check the items' aria-hidden instead.
    if (swallowRef.current) {
      swallowRef.current = false;
      return;
    }
    if (!player) return;
    if (player.state.paused) player.play().catch(() => {});
    else player.pause();
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!player) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    if (ratio < 0.35) {
      player.currentTime = Math.max(0, player.currentTime - 10);
    } else if (ratio > 0.65) {
      player.currentTime = Math.min(duration || 0, player.currentTime + 10);
    } else if (fullscreen) {
      remote.exitFullscreen('prefer-media', event);
    } else {
      // Mirror FullscreenButton: the trigger event MUST be forwarded — the
      // legacy argless requestFullscreen() loses the user gesture in the
      // request queue and fails silently (verified live: dblclick reached
      // the handler, no error, no fullscreen).
      remote.enterFullscreen('prefer-media', event);
      if (player.state.paused) player.play().catch(() => {});
    }
  };

  return (
    <div className="vds-gestures" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onDoubleClick={onDoubleClick} />
  );
}

export function GlassControls({ announcements, onAnnouncementsChange, enhancement }: GlassControlsProps) {
  useKeyboardShortcuts();
  const live = useMediaState('live');
  // React-driven fullscreen hook for the bar lift: vidstack also reflects
  // data-fullscreen on an ancestor, but a state class keeps the styling
  // trigger inside our own tree.
  const fullscreen = useMediaState('fullscreen');

  return (
    <>
      <SeekGestures />

      <Captions className="vds-captions" />

      <Spinner.Root className="glass-spinner">
        <Spinner.Track className="glass-spinner-track">
          <Spinner.TrackFill className="glass-spinner-fill" />
        </Spinner.Track>
      </Spinner.Root>

      {announcements && <MediaAnnouncer translations={turkishTranslations} />}

      <Controls.Root className={fullscreen ? 'glass-controls glass-is-fullscreen' : 'glass-controls'}>
        {!live && (
          <TimeSlider.Root className="glass-time-slider" aria-label={t('Seek')}>
            <TimeSlider.Track className="glass-slider-track">
              <TimeSlider.TrackFill className="glass-slider-fill glass-slider-track" />
              <TimeSlider.Progress className="glass-slider-progress glass-slider-track" />
              <TimeSlider.Thumb className="glass-slider-thumb" />
            </TimeSlider.Track>
            <TimeSlider.Preview className="glass-slider-preview">
              <TimeSlider.Value className="glass-slider-value" />
            </TimeSlider.Preview>
          </TimeSlider.Root>
        )}

        <Controls.Group className="glass-button-row">
          {!live && (
            <div className="glass-pill glass-play-pill" role="group" aria-label="Oynatma">
              <GlassPlayButton />

              <div
                className="glass-volume"
                onMouseLeave={(event) => {
                  // A pointer press focuses the slider (kept focusable for
                  // keyboard users), which would hold :focus-within and keep
                  // the pill stretched after the mouse leaves — drop that
                  // focus so the pill shrinks back. Pure keyboard focus
                  // never fires mouseleave, so it stays open while tabbing.
                  const focused = event.currentTarget.querySelector(':focus');
                  if (focused instanceof HTMLElement) focused.blur();
                }}
              >
                <GlassMuteButton />
                <VolumeSlider.Root className="glass-volume-slider" aria-label={t('Volume')}>
                  <VolumeSlider.Track className="glass-volume-track">
                    <VolumeSlider.TrackFill className="glass-volume-fill glass-volume-track" />
                    <VolumeSlider.Thumb className="glass-volume-thumb" />
                  </VolumeSlider.Track>
                </VolumeSlider.Root>
                <GlassVolumeValue />
              </div>
            </div>
          )}

          {!live && (
            <div className="glass-pill glass-time-pill">
              <div className="glass-time">
                <Time className="glass-time-current" type="current" />
                <span className="glass-time-divider">•</span>
                <Time className="glass-time-duration" type="duration" />
              </div>
            </div>
          )}

          {live && <div className="glass-live-spacer" />}

          {!live && <GlassTitle />}

          <div className="glass-spacer" />

          <SettingsMenu announcements={announcements} onAnnouncementsChange={onAnnouncementsChange}>
            <GlassPipButton />
            <EnhancementPanel
              preset={enhancement.preset}
              onPresetChange={enhancement.onPresetChange}
              filters={enhancement.filters}
              onFiltersChange={enhancement.onFiltersChange}
              stats={enhancement.stats}
              isActive={enhancement.isActive}
              panelOpen={enhancement.panelOpen}
              onPanelToggle={enhancement.onPanelToggle}
            />
            <GlassFullscreenButton />
          </SettingsMenu>
        </Controls.Group>
      </Controls.Root>
    </>
  );
}
