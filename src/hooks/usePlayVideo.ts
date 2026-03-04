import { showNotification } from "@mantine/notifications";
import { useState } from "react";

import { getLastVideoPlayed, getSettings } from "../database/utils";
import { normalizeInstanceUri } from "../utils/invidiousInstance";
import { log } from "../utils/logger";
import { useSetHistory } from "../providers/History";
import {
  initialPlayerState,
  useSetPlayerFallbackUrls,
  useSetPlayerState,
  useSetPlayerUrl,
  useSetPlayerVideo,
} from "../providers/Player";
import { useSetPlayerPlaylist } from "../providers/PlayerPlaylist";
import { useSetPreviousNextVideos } from "../providers/PreviousNextTrack";
import { useSettings } from "../providers/Settings";
import { getSponsorBlockSegments } from "../services/sponsor-block";
import { getVideo } from "../services/video";
import {
  isAppleMusicVideoId,
  parseAppleMusicVideoId,
} from "../services/appleMusic";
import type { Video, VideoThumbnail } from "../types/interfaces/Video";
import { colorExtractor } from "../utils/colorExtractor";
import { useResolveVideosPlaylist } from "./useResolveVideosPlaylist";

const DEFAULT_PRIMARY_COLOR = {
  color: "#000",
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
 * Resolve an Apple Music virtual videoId to a real Invidious videoId
 * by searching for "artist - title" on the configured Invidious instance.
 */
const resolveAppleMusicId = async (
  virtualId: string,
  invidiousBaseUri: string,
): Promise<string> => {
  const parsed = parseAppleMusicVideoId(virtualId);
  if (!parsed) throw new Error("Invalid Apple Music video ID");
  const query = `${parsed.artist} - ${parsed.title}`;
  const url = `${invidiousBaseUri}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance&page=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Invidious search failed: ${res.status}`);
  const data = await res.json();
  const results: any[] = Array.isArray(data) ? data : [];
  const match = results.find(
    (v) => v.type === "video" && v.videoId && v.lengthSeconds > 0 && !v.liveNow,
  );
  if (!match) throw new Error(`No Invidious result found for: ${query}`);
  return match.videoId as string;
};

export const usePlayVideo = () => {
  const [loading, setLoading] = useState(false);
  const settings = useSettings();
  const setPlayerUrl = useSetPlayerUrl();
  const setPlayerFallbackUrls = useSetPlayerFallbackUrls();
  const setPlayerVideo = useSetPlayerVideo();
  const setPlayerState = useSetPlayerState();
  const getVideosPlaylist = useResolveVideosPlaylist();
  const setPlayerPlaylist = useSetPlayerPlaylist();
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
        const baseUri = normalizeInstanceUri(
          getSettings().currentInstance?.uri ?? "",
        );
        if (!baseUri) throw new Error("No Invidious instance configured");
        resolvedVideoId = await resolveAppleMusicId(videoId, baseUri);
      }

      const [sponsorBlockSegments, data] = await Promise.all([
        settings.sponsorBlock
          ? getSponsorBlockSegments(resolvedVideoId)
          : { segments: null },
        getVideo(resolvedVideoId),
      ]);

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

      const colors = await colorExtractor
        .extractColor(videoThumbnailUrl)
        .catch(console.log);

      if (getLastVideoPlayed()?.videoId !== resolvedVideoId) {
        setHistory(data.video);
      }

      setPlayerUrl(data.url);
      setPlayerFallbackUrls(data.fallbackUrls ?? []);
      setPlayerVideo({
        video: data.video,
        thumbnailUrl: videoThumbnailUrl,
        primaryColor: colors ? colors[0] : DEFAULT_PRIMARY_COLOR,
        sponsorBlockSegments: sponsorBlockSegments.segments,
      });
      setPlayerState((previousState) => ({
        ...initialPlayerState,
        repeat: previousState.repeat,
        volume: previousState.volume,
      }));

      const videosPlaylist =
        playerPlaylist ?? getVideosPlaylist() ?? data.video.recommendedVideos;

      setPlayerPlaylist(videosPlaylist);

      setPreviousNextVideos(getPreviousAndNextVideoId(videosPlaylist, resolvedVideoId));
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
