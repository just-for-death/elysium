import { showNotification } from "@mantine/notifications";
import { useState } from "react";

import { getLastVideoPlayed, getSettings } from "../database/utils";
import { normalizeInstanceUri } from "../utils/invidiousInstance";
import type { Instance } from "../types/interfaces/Instance";
import { log } from "../utils/logger";
import { useSetHistory } from "../providers/History";
import {
  initialPlayerProgress,
  initialPlayerStatus,
  useSetPlayerFallbackUrls,
  useSetPlayerProgress,
  useSetPlayerStatus,
  useSetPlayerUrl,
  useSetPlayerVideo,
} from "../providers/Player";
import { usePlayerPlaylist, useSetPlayerPlaylist, usePinnedVideoIds } from "../providers/PlayerPlaylist";
import { useSetPreviousNextVideos } from "../providers/PreviousNextTrack";
import { useSettings } from "../providers/Settings";
import { getSponsorBlockSegments } from "../services/sponsor-block";
import { getVideo, isAppleWebKit } from "../services/video";
import {
  isAppleMusicVideoId,
  parseAppleMusicVideoId,
} from "../services/appleMusic";
import type { Video, VideoThumbnail } from "../types/interfaces/Video";
import { colorExtractor } from "../utils/colorExtractor";
import { displayTimeBySeconds } from "../utils/displayTimeBySeconds";
import { useResolveVideosPlaylist } from "./useResolveVideosPlaylist";

const DEFAULT_PRIMARY_COLOR = {
  color: "#000000",
  count: 1,
};

const getPreviousAndNextVideoId = (videos: Video[], videoId: string) => {
  const currentVideoIndex = videos.findIndex(
    (video) => video.videoId === videoId,
  );
  const previousVideoId = videos[currentVideoIndex - 1]?.videoId ?? null;
  const nextVideoId = videos[currentVideoIndex + 1]?.videoId ?? null;

  return {
    videosIds: {
      previousVideoId,
      nextVideoId,
    },
  };
};

/**
 * Fetch with a manual timeout using AbortController (avoids DOMException from AbortSignal.timeout).
 */
const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Resolve an Apple Music virtual videoId to a real Invidious videoId
 * by searching for "artist - title" on available Invidious instances.
 * Tries the configured instance first, then falls back to other known instances.
 */
const resolveAppleMusicId = async (
  virtualId: string,
  invidiousBaseUri: string,
  allInstances?: Instance[],
): Promise<string> => {
  const parsed = parseAppleMusicVideoId(virtualId);
  if (!parsed) throw new Error("Invalid Apple Music video ID");
  const query = `${parsed.artist} - ${parsed.title}`;
  const path = `/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance&page=1`;

  // Build list of URIs to try: configured first, then any custom instances, then skip
  const urisToTry = [invidiousBaseUri];
  if (allInstances) {
    for (const inst of allInstances) {
      const uri = normalizeInstanceUri(inst.uri);
      if (uri && uri !== invidiousBaseUri) urisToTry.push(uri);
      if (urisToTry.length >= 4) break; // cap at 4 instances to avoid long waits
    }
  }

  let lastError: unknown;
  for (const baseUri of urisToTry) {
    for (const timeoutMs of [12000, 18000]) {
      try {
        const res = await fetchWithTimeout(`${baseUri}${path}`, timeoutMs);
        if (!res.ok) throw new Error(`Invidious search failed: ${res.status}`);
        const data = await res.json();
        const results: any[] = Array.isArray(data) ? data : [];
        const match = results.find(
          (v) => v.type === "video" && v.videoId && v.lengthSeconds > 0 && !v.liveNow,
        );
        if (!match) throw new Error(`No result found for: ${query}`);
        return match.videoId as string;
      } catch (err) {
        lastError = err;
        const isAbort =
          err instanceof DOMException &&
          (err.name === "AbortError" || err.name === "TimeoutError");
        const isNetwork = err instanceof TypeError;
        if (!isAbort && !isNetwork) break; // non-network error → skip retries on this instance
      }
    }
  }
  throw lastError;
};

export const usePlayVideo = () => {
  const [loading, setLoading] = useState(false);
  const settings = useSettings();
  const setPlayerUrl = useSetPlayerUrl();
  const setPlayerFallbackUrls = useSetPlayerFallbackUrls();
  const setPlayerVideo = useSetPlayerVideo();
  const setPlayerStatus = useSetPlayerStatus();
  const setPlayerProgress = useSetPlayerProgress();
  const getVideosPlaylist = useResolveVideosPlaylist();
  const setPlayerPlaylist = useSetPlayerPlaylist();
  const currentPlaylist = usePlayerPlaylist();
  const pinnedVideoIds = usePinnedVideoIds();
  const setPreviousNextVideos = useSetPreviousNextVideos();
  const setHistory = useSetHistory();

  const handlePlay = async (
    videoId: string,
    playerPlaylist: Video[] | null = null,
  ) => {
    setLoading(true);

    try {
      // If this is an Apple Music virtual ID, resolve it to a real YT videoId first
      let resolvedVideoId = videoId;
      if (isAppleMusicVideoId(videoId)) {
        const currentSettings = getSettings();
        const baseUri = normalizeInstanceUri(
          currentSettings.currentInstance?.uri ?? "",
        );
        if (!baseUri) throw new Error("No Invidious instance configured");
        const allInstances = [
          ...(currentSettings.customInstances ?? []),
          ...(settings.instances ?? []),
        ];
        resolvedVideoId = await resolveAppleMusicId(videoId, baseUri, allInstances);
      }

      // ── Fetch video data and SponsorBlock in parallel ─────────────────
      // We start audio the INSTANT getVideo resolves — don't wait for SponsorBlock.
      // SponsorBlock result is applied after playback starts (non-blocking).
      const sponsorBlockPromise = settings.sponsorBlock
        ? getSponsorBlockSegments(resolvedVideoId)
        : Promise.resolve({ segments: null });

      const data = await getVideo(resolvedVideoId);

      // PERFORMANCE FIX (iPad/iOS): TCP connection pre-warm.
      // On cellular, establishing a TLS+TCP connection to the Invidious stream
      // takes 50-200ms. Without this, that latency happens INSIDE audio.load(),
      // adding directly to the time until canplay fires.
      // By firing a tiny Range request immediately after getVideo() resolves —
      // before React's state update cycle even begins — we establish the
      // connection in parallel with React rendering. When audio.load() fires
      // milliseconds later it reuses the existing connection (HTTP/2 or keep-alive),
      // cutting canplay latency by the full connection establishment time.
      // Only on iOS: desktop connections are already fast enough.
      if (isAppleWebKit && data.url) {
        fetch(data.url, {
          headers: { Range: "bytes=0-1023" },
          signal: AbortSignal.timeout(5000),
        }).catch(() => {}); // fire-and-forget, errors are harmless
      }

      if (!data.url) {
        throw new Error("No video url found");
      }

      const THUMBNAIL_QUALITY_PRIORITY = [
        "sddefault",
        "high",
        "medium",
        "default",
        "maxresdefault",
      ] as const;

      const videoThumbnail =
        THUMBNAIL_QUALITY_PRIORITY.reduce<VideoThumbnail | undefined>(
          (found, quality) =>
            found ??
            data.video.videoThumbnails.find((t) => t.quality === quality),
          undefined,
        ) ?? data.video.videoThumbnails[0];

      if (!videoThumbnail) {
        throw new Error("No thumbnails available for this video");
      }

      let videoThumbnailUrl = videoThumbnail.url;

      if (videoThumbnail.url.startsWith("/")) {
        const base = normalizeInstanceUri(
          getSettings().currentInstance?.uri,
        );
        videoThumbnailUrl = base ? `${base.replace(/\/+$/, "")}${videoThumbnailUrl}` : videoThumbnail.url;
      }

      if (getLastVideoPlayed()?.videoId !== resolvedVideoId) {
        setHistory(data.video);
      }

      // ── Start playback immediately with empty sponsorBlock segments ────
      setPlayerUrl(data.url);
      setPlayerFallbackUrls(data.fallbackUrls ?? []);
      setPlayerVideo({
        video: data.video,
        thumbnailUrl: videoThumbnailUrl,
        primaryColor: DEFAULT_PRIMARY_COLOR,
        sponsorBlockSegments: null,
      });
      // Pre-set duration from API data immediately so the UI shows the correct
      // total time from the moment the track starts — before loadedmetadata fires.
      // This is especially important on iPad where loadedmetadata can be delayed.
      const knownDuration = data.video.lengthSeconds ?? 0;
      // Reset progress immediately (clears the progress bar from the old track)
      setPlayerProgress(initialPlayerProgress);
      // Reset status, preserving repeat and volume, pre-setting duration
      setPlayerStatus((previousStatus) => ({
        ...initialPlayerStatus,
        repeat: previousStatus.repeat,
        volume: previousStatus.volume,
        ...(knownDuration > 0 ? {
          audioDuration: knownDuration,
          duration:      displayTimeBySeconds(knownDuration),
        } : {}),
      }));

      // When auto-queue curation is active (discover / similar / my_taste modes),
      // do NOT seed the playlist with Invidious's recommendedVideos. Instead start
      // with only the current video so that useAutoQueue is the sole authority on
      // what plays next. This prevents the "Next song" drawer from being pre-filled
      // with Invidious/YouTube suggestions that would mask or duplicate picks.
      // Use getSettings() (DB-direct) not the React-state 'settings' to get the
      // freshest value, avoiding any stale-closure issue mid-session.
      const dbSettings = getSettings();
      const queueMode: string = (dbSettings as any).queueMode ?? "off";
      // Legacy compat: ollamaEnabled without queueMode set
      const legacyOllama = (dbSettings as any).ollamaEnabled && !!(dbSettings as any).ollamaUrl;
      const effectiveMode = queueMode !== "off" ? queueMode : legacyOllama ? "ollama" : "off";
      // For any auto-queue mode other than "invidious", seed with just the
      // current video so the queue hook can inject its own suggestions.
      // For "invidious" mode or "off", fall through to recommendedVideos.
      const autoQueueActive = effectiveMode !== "off" && effectiveMode !== "invidious";

      const videosPlaylist =
        playerPlaylist ??
        getVideosPlaylist() ??
        (autoQueueActive ? [data.video] : data.video.recommendedVideos);

      // When auto-queue is active and we're NOT starting from an explicit playlist,
      // preserve any pinned (manually-queued) items from the previous queue so
      // they survive the song change. Pinned items are inserted after the new
      // current track, before auto-queue suggestions.
      let finalPlaylist = videosPlaylist;
      if (autoQueueActive && !playerPlaylist && pinnedVideoIds.size > 0) {
        const pinnedItems = currentPlaylist.filter(
          (v) => pinnedVideoIds.has(v.videoId) && v.videoId !== resolvedVideoId,
        );
        if (pinnedItems.length > 0) {
          // Insert pinned items right after the new current track
          const currentIdx = finalPlaylist.findIndex((v) => v.videoId === resolvedVideoId);
          const insertAt = currentIdx >= 0 ? currentIdx + 1 : 1;
          finalPlaylist = [
            ...finalPlaylist.slice(0, insertAt),
            ...pinnedItems.filter((p) => !finalPlaylist.some((v) => v.videoId === p.videoId)),
            ...finalPlaylist.slice(insertAt),
          ];
        }
      }

      setPlayerPlaylist(finalPlaylist);
      setPreviousNextVideos(getPreviousAndNextVideoId(finalPlaylist, resolvedVideoId));

      // ── Apply SponsorBlock + color in background after audio starts ────
      Promise.all([
        sponsorBlockPromise,
        colorExtractor.extractColor(videoThumbnailUrl).catch(() => null),
      ]).then(([sponsorBlockSegments, colors]) => {
        setPlayerVideo({
          video: data.video,
          thumbnailUrl: videoThumbnailUrl,
          primaryColor: colors?.[0] ?? DEFAULT_PRIMARY_COLOR,
          sponsorBlockSegments: sponsorBlockSegments.segments,
        });
      }).catch(() => { /* non-fatal */ });
    } catch (error) {
      log.error("handlePlay failed", { videoId, error });
      showNotification({
        title: "Error",
        message: error instanceof Error ? error.message : String(error),
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    handlePlay,
  };
};
