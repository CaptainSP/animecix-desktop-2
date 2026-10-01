import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  MediaPlayer,
  MediaProvider,
  Track,
  LibASSTextRenderer,
  isHLSProvider,
  type MediaPlayerInstance,
  type MediaProviderAdapter,
} from '@vidstack/react';
import {
  DefaultVideoLayout,
  defaultLayoutIcons,
} from '@vidstack/react/player/layouts/default';

import { turkishTranslations } from './translations';
import { SkipButton } from './SkipButton';
import { MusicInfo } from './MusicInfo';
import { NavigationButtons } from './NavigationButtons';
import { EnhancementPanel } from './EnhancementPanel';
import { FlatSettingsMenu } from './FlatSettingsMenu';
import { CaptionStylesMenu } from './CaptionStylesMenu';
import { CaptionsMenu } from './CaptionsMenu';
import { QualityMenu } from './QualityMenu';
import { PLAYBACK_RATES, SpeedMenu } from './SpeedMenu';
import { LiveBadge } from './LiveBadge';
import { ViewerCount } from './ViewerCount';
import { useVideoData } from '../hooks/useVideoData';
import { useParentMessages, postToParent } from '../hooks/useParentMessages';
import { useQualityPersistence } from '../hooks/useQualityPersistence';
import { useVideoEnhancement } from '../hooks/useVideoEnhancement';
import { useLiveMode } from '../hooks/useLiveMode';
import { useQualityGuard } from '../hooks/useQualityGuard';
import { usePlaybackRecovery } from '../hooks/usePlaybackRecovery';
import { readPreferredQualityHeight } from './preferredQuality';
import type { Video, SkipMeta } from '../types';
import { useColorExtraction } from '../hooks/useColorExtraction';
import './EmbedPlayer.css';

const regionNamesInTurkish = new Intl.DisplayNames(['tr'], {
  type: 'language',
});

const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Vidstack otherwise pulls hls.js from jsDelivr at runtime (`hls.js@^1.5.0`),
// which in a packaged app under tau-player:// means reaching the network for a
// core dependency. Point it at the bundled copy so package.json decides, and so
// it keeps working offline. Dormant while the API strips HLS (DISABLE_HLS) and
// cached streams are muxed to MP4 before they reach the player.
function onProviderChange(provider: MediaProviderAdapter | null) {
  if (isHLSProvider(provider)) {
    provider.library = () => import('hls.js');
  }
}

function parseIdFromPath(): string {
  // Support /embed/:id and /embed-2/:id path formats
  const segments = window.location.pathname.split('/').filter(Boolean);
  return segments[segments.length - 1] || '';
}

function parseVidFromSearch(): string | undefined {
  const params = new URLSearchParams(window.location.search);
  return params.get('vid') || undefined;
}

export function EmbedPlayer() {
  const id = parseIdFromPath();
  const vid = parseVidFromSearch();
  const isOffline = id === 'offline';

  const playerRef = useRef<MediaPlayerInstance>(null);
  const readyFiredRef = useRef(false);

  const { data, meta, loading, offlineNav, fetchVideo, setPrefetchedData } = useVideoData(id, vid);
  const { liveState, setLiveMode, liveSeek, updateViewerCount, endLiveMode } = useLiveMode(playerRef);
  const canvasRef = useColorExtraction();
  const enhancementContainerRef = useRef<HTMLDivElement>(null);

  // Re-applies the manual quality preference after every episode switch
  // (PLAY-05) — the "Otomatik" quality menu option resets otherwise.
  const sourcesSignature = data
    ? data.hls || data.urls.map((item) => item.url).join('|')
    : null;
  useQualityPersistence(playerRef, sourcesSignature);

  const {
    preset, setPreset, filters, setFilters,
    isActive, hasOutput, stats, panelOpen, setPanelOpen,
  } = useVideoEnhancement(enhancementContainerRef);

  // HLS carries its own seamless switching; only the MP4 ladder needs pinning.
  const qualityGuard = useQualityGuard(playerRef, { pinAuto: !data?.hls });

  const onPlaybackUnrecoverable = useCallback(() => {
    // The nudge did not take either, so this player is not going to start.
    // Hand it back to the site, which reloads the iframe from scratch.
    postToParent('changeVideoFailed');
  }, []);
  const playback = usePlaybackRecovery(playerRef, {
    onUnrecoverable: onPlaybackUnrecoverable,
  });

  // changeVideo: swap in the next episode without reloading the iframe.
  //
  // The playhead is wound back first. Vidstack keeps the same <video> element
  // and provider across an episode change, so a finished episode hands the swap
  // an element parked at end-of-stream, and the new stream's start position gets
  // derived from that stale playhead — leaving a black frame that only a manual
  // seek escapes.
  const changeVideo = useCallback(
    (videoId: string, videoVid?: string) => {
      const player = playerRef.current;
      if (player) {
        player.currentTime = 0;
      }
      readyFiredRef.current = false;
      fetchVideo(videoId, videoVid).then((result) => {
        if (result !== 'failed') return;
        // Nothing replaced the finished episode, so the viewer is still staring
        // at its end screen. Tell the site, which can fall back to a full iframe
        // reload rather than leaving the next-episode button looking dead.
        postToParent('changeVideoFailed', { id: videoId });
      });
    },
    [fetchVideo]
  );

  // Read preferred language from localStorage as fast default
  // Note: 'prefered_language' is the tau-website spelling — kept for compatibility
  const preferredLang = localStorage.getItem('prefered_language') || 'tr';

  // Memoised because useParentMessages keys its listener and reporting timers
  // off these identities — rebuilding them every render used to tear the
  // interval down before it could ever fire.
  const tracks = useMemo(
    () =>
      (data?.subs || []).map((sub) => ({
        kind: 'subtitles' as const,
        label: regionNamesInTurkish.of(sub.language) + ' - ' + sub.name,
        src: isIOS ? import.meta.env.VITE_API_BASE_URL + '/vtt/' + sub.id : sub.url,
        language: sub.language,
        type: (isIOS ? 'vtt' : 'ass') as 'vtt' | 'ass',
      })),
    [data]
  );

  // Only one track per kind may be default. Marking every same-language track
  // default made the player wait on all of them before it could start.
  const defaultTrackIndex = tracks.findIndex(
    (track) => track.language === preferredLang
  );

  // Register LibASSTextRenderer on non-iOS platforms only
  useEffect(() => {
    if (isIOS) return;

    const player = playerRef.current;
    if (!player) return;

    const renderer = new LibASSTextRenderer(() => import('jassub') as never, {
      workerUrl: '/jassub/jassub-worker.js',
      wasmUrl: '/jassub/jassub-worker.wasm',
      prescaleFactor: 1 / window.devicePixelRatio,
      defaultFont: 'Caladea',
    } as never);

    player.textRenderers.add(renderer);

    return () => {
      player.textRenderers.remove(renderer);
    };
  }, []);

  // Preserve playback position across fullscreen transitions.
  // HLS re-evaluates quality variants on viewport resize (fullscreen toggle),
  // which can reset currentTime to 0 in "Otomatik" mode. This effect saves
  // the position before the change and restores it if it gets reset.
  useEffect(() => {
    let savedTime = -1;
    let restoreTimer: ReturnType<typeof setTimeout> | null = null;

    const onFsChange = () => {
      const player = playerRef.current;
      if (!player) return;

      const isFs = !!document.fullscreenElement;
      if (isFs) {
        savedTime = player.currentTime;
      } else if (savedTime > 0) {
        const t = savedTime;
        savedTime = -1;
        const tryRestore = () => {
          const p = playerRef.current;
          if (p && p.currentTime < 1 && t > 1) {
            p.currentTime = t;
          }
        };
        tryRestore();
        player.addEventListener('loadeddata', tryRestore, { once: true });
        restoreTimer = setTimeout(tryRestore, 800);
      }
    };

    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      if (restoreTimer) clearTimeout(restoreTimer);
    };
  }, []);

  // Handle changeSub from parent iframe (animecix.tv bridge for SQLite preference)
  const changeSub = useCallback(
    (index: number) => {
      const player = playerRef.current;
      if (!player) return;

      const textTracks = player.textTracks.toArray();
      // Disable all subtitle/caption tracks first
      for (const t of textTracks) {
        if (t.kind === 'subtitles' || t.kind === 'captions') {
          t.mode = 'disabled';
        }
      }

      // index 0 means off, 1-based for subs
      if (index >= 1 && index <= tracks.length) {
        const target = textTracks.find(
          (t) =>
            (t.kind === 'subtitles' || t.kind === 'captions') &&
            t.src === tracks[index - 1].src
        );
        if (target) {
          target.mode = 'showing';
          // Update localStorage cache to match SQLite-loaded preference
          localStorage.setItem('prefered_language', tracks[index - 1].language);
          postToParent('captionsChanged', { track: index });
        }
      }
    },
    [tracks]
  );

  // Handle pre-fetched video data from desktop app (fast path)
  const onInitVideoData = useCallback((video: Video, skipMeta: SkipMeta | null) => {
    setPrefetchedData(video, skipMeta);
  }, [setPrefetchedData]);

  const liveCallbacks = useMemo(
    () => ({ setLiveMode, liveSeek, updateViewerCount, endLiveMode }),
    [setLiveMode, liveSeek, updateViewerCount, endLiveMode]
  );

  // Parent message handler
  const { navInfo } = useParentMessages(
    playerRef,
    changeSub,
    changeVideo,
    onInitVideoData,
    liveCallbacks
  );

  // Report caption changes to parent (when user manually changes subtitles in player UI)
  // This triggers animecix.tv to persist the preference to SQLite via IPC
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    function onTextTrackChange() {
      const active = player!.textTracks.toArray().find(
        (t) =>
          (t.kind === 'subtitles' || t.kind === 'captions') &&
          t.mode === 'showing'
      );
      if (active) {
        const idx = tracks.findIndex((t) => t.src === active.src);
        if (idx !== -1) {
          // Update local cache
          localStorage.setItem('prefered_language', tracks[idx].language);
          // Notify parent (animecix.tv) to persist to SQLite via IPC
          postToParent('captionsChanged', { track: idx + 1 });
        }
      }
    }

    player.textTracks.addEventListener('mode-change', onTextTrackChange);
    return () => {
      player.textTracks.removeEventListener('mode-change', onTextTrackChange);
    };
  }, [tracks]);

  // Disable context menu (prevents video URL exposure — T-02-12)
  useEffect(() => {
    document.oncontextmenu = (e) => e.preventDefault();
  }, []);

  const sources = useMemo((): unknown => {
    if (!data) return undefined;
    if (data.hls) return { src: data.hls, type: 'application/x-mpegurl' };
    if (data.urls.length === 0) return undefined;

    const entries = data.urls.map((item) => {
      const height = parseInt(item.label.replace('p', ''));
      return {
        src: item.url,
        height,
        width: Math.floor((data.ratio || 16 / 9) * height),
        type: 'video/mp4',
        bitrate: (8 * item.size) / (data.duration || 1),
        codec: 'h264',
      };
    });

    // Vidstack loads the first entry it can play, and only then does its own
    // auto quality score the ladder against the player's size and swap
    // `video.src` — a second load() that aborts the first. Leading with the
    // entry it is going to settle on makes that swap a no-op: no abandoned
    // download of the wrong file on every episode change, and no window where
    // `canPlay` fires for a source that is about to be torn down, which is what
    // left playback on a black frame with a play() promise that never settled.
    //
    // This mirrors Vidstack's own scorer. Guessing wrong only costs the extra
    // switch that happens today, so it degrades instead of breaking.
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const distance = (entry: { width: number; height: number }) =>
      Math.abs(entry.width - viewportWidth) +
      Math.abs(entry.height - viewportHeight);

    // A stored quality outranks the viewport guess: that is the one
    // useQualityPersistence restores just after canPlay, and the restore is
    // what aborts the first fetch when it lands on a different source.
    const preferredHeight = readPreferredQualityHeight();

    return [...entries].sort((a, b) => {
      if (preferredHeight !== null) {
        const aPreferred = a.height === preferredHeight ? 0 : 1;
        const bPreferred = b.height === preferredHeight ? 0 : 1;
        if (aPreferred !== bPreferred) return aPreferred - bPreferred;
      }
      return distance(a) - distance(b);
    });
  }, [data]);

  // Event handlers
  function onCanPlay() {
    qualityGuard.handleCanPlay();
    playerRef.current?.play().catch(() => {});
    // That promise never settles at all when the pipeline comes up with nothing
    // at the playhead, so watch the playhead instead of awaiting it.
    playback.arm();

    postToParent('canPlay', { first: !readyFiredRef.current });

    if (!readyFiredRef.current) {
      postToParent('getCurrentTime');
    }
    readyFiredRef.current = true;
  }

  function onEnded() {
    playback.disarm();
    if (isOffline && offlineNav?.nextEpisodeId) {
      // INTENTIONAL `any` — offline player has no preload bridge. See OPEN-SOURCE-AUDIT.md §2.
      (window as any).animecix?.playOfflineEpisode?.(offlineNav.nextEpisodeId); // eslint-disable-line @typescript-eslint/no-explicit-any
      return;
    }
    postToParent('ended');
  }

  function onPlay() {
    postToParent('play');
  }

  function onPause() {
    postToParent('pause');
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="loadingio-spinner-rolling">
          <div className="ldio-spinner">
            <div></div>
          </div>
        </div>
      </div>
    );
  }

  if (!data || (!data.hls && data.urls.length === 0)) {
    return (
      <div className="encoding">
        <div>
          <h1 style={{ textAlign: 'center' }}>Video işleniyor</h1>
          <p>
            Bu işlem biraz zaman alabilir. Lütfen daha sonra tekrar deneyiniz.
          </p>
        </div>
      </div>
    );
  }

  const showOfflineNav = isOffline && offlineNav;

  return (
    <>
      {/* INTENTIONAL `any` casts below — offline player has no preload bridge.
          See OPEN-SOURCE-AUDIT.md "Intentional Bypasses §2". */}
      {isOffline && (
        <div className="offline-header">
          <button
            className="offline-back-btn"
            aria-label="Kutuphaneye don"
            onClick={() => (window as any).animecix?.showLibrary?.()}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
            </svg>
          </button>
          {offlineNav && (
            <span className="offline-episode-info">
              {offlineNav.episodeTitle}
              {offlineNav.seasonNumber && offlineNav.episodeNumber &&
                ` — S${offlineNav.seasonNumber}E${offlineNav.episodeNumber}`}
            </span>
          )}
          {showOfflineNav && (offlineNav.prevEpisodeId || offlineNav.nextEpisodeId) && (
            <div className="offline-nav">
              {offlineNav.prevEpisodeId && (
                <button
                  className="offline-nav-btn"
                  aria-label="Onceki bolum"
                  onClick={() => (window as any).animecix?.playOfflineEpisode?.(offlineNav.prevEpisodeId)}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                    <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                  </svg>
                </button>
              )}
              {offlineNav.nextEpisodeId && (
                <button
                  className="offline-nav-btn"
                  aria-label="Sonraki bolum"
                  onClick={() => (window as any).animecix?.playOfflineEpisode?.(offlineNav.nextEpisodeId)}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <MediaPlayer
        ref={playerRef}
        src={sources as never}
        autoPlay
        playsInline
        crossOrigin={isOffline ? undefined : 'anonymous'}
        storage="tau-video"
        duration={data.duration}
        load="eager"
        // Vidstack defaults to "metadata", which parks the element on an empty
        // buffer waiting for a play() that has to un-suspend it. Everything here
        // autoplays, so there is nothing to save by holding back.
        preload="auto"
        onProviderChange={onProviderChange}
        onQualityChange={qualityGuard.handleQualityChange}
        onError={qualityGuard.handleError}
        onCanPlay={onCanPlay}
        onEnded={onEnded}
        onPlay={onPlay}
        onPause={onPause}
        onFullscreenChange={(isFullscreen: boolean) => {
          postToParent(isFullscreen ? 'enterFullscreen' : 'exitFullscreen');
        }}
        style={{ height: '100vh' }}
        className={`${hasOutput ? 'enhancement-active' : ''} ${liveState.enabled ? 'live-mode' : ''}`}
      >
        <MediaProvider>
          {tracks.map((track, i) => (
            <Track
              key={String(i)}
              src={track.src}
              kind={track.kind}
              label={track.label}
              language={track.language}
              default={i === defaultTrackIndex}
              type={track.type}
            />
          ))}
        </MediaProvider>

        <div
          ref={enhancementContainerRef}
          className="enhancement-container"
          style={{ display: isActive ? 'block' : 'none' }}
        />

        <DefaultVideoLayout
          icons={defaultLayoutIcons}
          translations={turkishTranslations}
          // The layout defaults to "system", which puts a `light` class on the
          // menus for viewers whose OS is in light mode. That class sets the
          // menu text to #1a1a1a — near-black on the dark glass panel this
          // player hardcodes, so labels all but disappear while the hints keep
          // their own lighter colour. Our chrome is dark, so say so.
          colorScheme="dark"
          thumbnails={isOffline ? undefined : import.meta.env.VITE_API_BASE_URL + '/preview/' + id}
          playbackRates={PLAYBACK_RATES}
          slots={{
            settingsMenuItemsStart: <FlatSettingsMenu />,
            settingsMenuItemsEnd: (
              <>
                <CaptionStylesMenu />
                <CaptionsMenu />
                <QualityMenu />
                <SpeedMenu />
              </>
            ),
            afterSettingsMenu: (
              <EnhancementPanel
                preset={preset}
                onPresetChange={setPreset}
                filters={filters}
                onFiltersChange={setFilters}
                stats={stats}
                isActive={isActive}
                panelOpen={panelOpen}
                onPanelToggle={() => setPanelOpen(!panelOpen)}
              />
            ),
          }}
        />
        <SkipButton meta={meta} />
        <MusicInfo meta={meta} />
        {navInfo && (
          <NavigationButtons
            hasNext={navInfo.hasNext}
            hasPrev={navInfo.hasPrev}
          />
        )}
      </MediaPlayer>

      <canvas
        ref={canvasRef}
        width={500}
        height={500}
        style={{ display: 'none' }}
      />
    </>
  );
}
