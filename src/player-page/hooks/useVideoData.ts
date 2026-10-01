import { useState, useCallback, useRef, useEffect } from 'react';
import type { Video, SkipMeta } from '../types';

const PLAYER_SECRET = import.meta.env.VITE_PLAYER_SECRET || '';

async function signSlug(slug: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(PLAYER_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(slug));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface OfflineNavigation {
  prevEpisodeId: string | null;
  nextEpisodeId: string | null;
  episodeTitle: string;
  seasonNumber: string;
  episodeNumber: string;
}

/**
 * 'superseded' means a newer fetch replaced this one — not a failure, so
 * callers must not treat it as one.
 */
export type FetchResult = 'loaded' | 'superseded' | 'failed';

export function useVideoData(initialId: string, initialVid?: string) {
  const [data, setData] = useState<Video | null>(null);
  const [meta, setMeta] = useState<SkipMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [offlineNav, setOfflineNav] = useState<OfflineNavigation | null>(null);
  const cancelRef = useRef<(() => void) | undefined>(undefined);
  // Track whether we received pre-fetched data from the parent (desktop app fast path)
  const prefetchedRef = useRef(false);

  const fetchVideo = useCallback(async (
    id: string,
    vid?: string
  ): Promise<FetchResult> => {
    if (!id) return 'failed';

    // Cancel previous fetch
    cancelRef.current?.();
    let cancelled = false;
    cancelRef.current = () => {
      cancelled = true;
    };

    setMeta(null);

    try {
      const url =
        import.meta.env.VITE_API_BASE_URL + '/api/video/' + id + (vid ? '?vid=' + vid : '');
      const res = await fetch(url);
      const videoData: Video = await res.json();

      if (cancelled) return 'superseded';
      setData(videoData);

      // Fetch skip markers
      const slug =
        videoData.title_id +
        '_' +
        videoData.season_number +
        '_' +
        videoData.episode_number +
        '_' +
        videoData.translator;

      try {
        const sig = await signSlug(slug);
        const metaRes = await fetch(
          import.meta.env.VITE_API_BASE_URL + '/api/most-sought/' +
            slug +
            '?tauId=' +
            videoData._id,
          { headers: { 'x-player-sig': sig } }
        );
        const metaData = await metaRes.json();
        if (!cancelled) setMeta(metaData);
      } catch {
        // Skip markers not available
      }

      return 'loaded';
    } catch (err) {
      console.error('Failed to fetch video data:', err);
      return 'failed';
    } finally {
      if (!cancelled) setLoading(false);
    }
  }, []);

  // Accept pre-fetched data from parent (desktop app fast path).
  // Called by useParentMessages when it receives 'initVideoData' postMessage.
  // Cancels any in-flight fetch and uses the pre-fetched data directly.
  const setPrefetchedData = useCallback((video: Video, skipMeta: SkipMeta | null) => {
    cancelRef.current?.();
    prefetchedRef.current = true;
    setData(video);
    setMeta(skipMeta);
    setLoading(false);
  }, []);

  // Initial fetch — starts immediately but setPrefetchedData cancels it if
  // pre-fetched data arrives via postMessage before the API responds
  useEffect(() => {
    if (initialId === 'offline') {
      // INTENTIONAL `any` cast — player runs under tau-player:// with no access to the
      // preload bridge types. This is the only IPC path for offline playback.
      // See OPEN-SOURCE-AUDIT.md "Intentional Bypasses §2".
      (window as any).animecix?.getOfflineVideoData?.().then((result: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (result?.video) {
          setPrefetchedData(result.video, result.skipMeta ?? null);
          if (result.navigation) {
            setOfflineNav(result.navigation);
          }
        }
      }).catch(() => {});
      return;
    }
    if (!prefetchedRef.current) {
      fetchVideo(initialId, initialVid);
    }
    return () => {
      cancelRef.current?.();
    };
  }, [initialId, initialVid, fetchVideo, setPrefetchedData]);

  return { data, meta, loading, offlineNav, fetchVideo, setPrefetchedData };
}
