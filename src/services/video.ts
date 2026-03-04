import { getSettings } from "../database/utils";
import type { AdaptiveFormat, Video } from "../types/interfaces/Video";
import { normalizeInstanceUri } from "../utils/invidiousInstance";
import { log } from "../utils/logger";

// Priority: AAC/MP4 first (Safari, broad support), then Opus (Chrome/Firefox, better quality)
const AUDIO_FORMAT_PRIORITY = [
  /audio\/mp4.*aac/i,   // AAC in MP4 — best compatibility
  /audio\/mp4/i,        // AAC in MP4 fallback
  /audio\/webm.*opus/i, // Opus in WebM — best quality where supported
  /audio\/webm/i,       // WebM audio generic
  /webm.*audio/i,       // WebM with audio track
  /audio\/mpeg/i,       // MP3 — universal fallback
];

const parseBitrate = (bitrate: string): number => {
  const match = /(\d+)/.exec(String(bitrate || ""));
  return match ? parseInt(match[1], 10) : 0;
};

/** Returns formats with valid URLs, sorted by preference (best first) */
const selectAudioFormats = (
  formats: AdaptiveFormat[],
): AdaptiveFormat[] => {
  const withUrl = formats.filter((f) => f?.url && typeof f.url === "string");
  const audioFormats = withUrl.filter(
    (f) => f.type?.includes("audio") || /webm|mp4|mpeg/.test(f.type || ""),
  );
  const pool = audioFormats.length > 0 ? audioFormats : withUrl;
  if (pool.length === 0) return [];

  const result: AdaptiveFormat[] = [];
  for (const pattern of AUDIO_FORMAT_PRIORITY) {
    const matches = pool.filter((f) => pattern.test(f.type || ""));
    if (matches.length === 0) continue;
    // Higher bitrate first within same type
    const sorted = matches.sort(
      (a, b) => parseBitrate(b.bitrate || "") - parseBitrate(a.bitrate || ""),
    );
    result.push(...sorted);
  }
  // Add any remaining formats not matched by priority
  const added = new Set(result);
  for (const f of pool) {
    if (!added.has(f)) result.push(f);
  }
  return result;
};

const buildVideoApiUrl = (baseUri: string, videoId: string, region?: string): string => {
  const url = new URL(`${baseUri}/api/v1/videos/${videoId}`);
  // Region hint for geo-restricted content (ISO 3166 country code)
  if (region?.length === 2) {
    url.searchParams.set("region", region);
  }
  // Request proxied stream URLs from the Invidious instance instead of direct
  // YouTube URLs. Without this, YouTube returns 403 because the signed stream
  // URLs are bound to the instance's IP, not the client's.
  url.searchParams.set("local", "true");
  return url.toString();
};

/**
 * Cobalt.tools fallback — used when Invidious is unavailable.
 * Cobalt is a free, open-source media downloader with a public API.
 * Docs: https://github.com/imputnet/cobalt
 */
const COBALT_INSTANCES = [
  "https://cobalt.tools",
  "https://co.wuk.sh",
  "https://api.cobalt.tools",
];

export const getVideoFromCobalt = async (
  videoId: string,
): Promise<{ url: string; fallbackUrls: string[] }> => {
  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

  for (const instance of COBALT_INSTANCES) {
    try {
      const res = await fetch(`${instance}/api/json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          url: youtubeUrl,
          isAudioOnly: true,
          audioFormat: "best",
          filenamePattern: "basic",
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) continue;

      const data = await res.json();
      if ((data.status === "stream" || data.status === "redirect" || data.status === "tunnel") && data.url) {
        log.debug("Cobalt fallback succeeded", { videoId, instance, status: data.status });
        return { url: data.url, fallbackUrls: [] };
      }
    } catch (err) {
      log.debug("Cobalt instance failed", { instance, err });
    }
  }

  throw new Error("Cobalt fallback failed: no working instance found");
};

export const getVideo = async (
  videoId: string,
): Promise<{ video: Video; url: string; fallbackUrls: string[] }> => {
  const { currentInstance } = getSettings();

  if (!currentInstance?.uri) {
    throw new Error("No Invidious instance configured");
  }

  const baseUri = normalizeInstanceUri(currentInstance.uri);
  const url = buildVideoApiUrl(
    baseUri,
    videoId,
    currentInstance.region,
  );
  log.debug("getVideo fetch", { videoId, url, instance: currentInstance.domain });

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  } catch (networkErr) {
    // Invidious unreachable — try Cobalt fallback for audio URL
    log.debug("Invidious unreachable, trying Cobalt fallback", { videoId, networkErr });
    const cobaltResult = await getVideoFromCobalt(videoId);
    // We don't have a Video object but we can return a minimal one so the player can still play
    const minimalVideo = {
      videoId,
      title: videoId,
      author: "",
      lengthSeconds: 0,
      videoThumbnails: [],
      adaptiveFormats: [],
      recommendedVideos: [],
    } as unknown as Video;
    return { video: minimalVideo, ...cobaltResult };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    log.fetchError("getVideo", url, response, body);

    // Invidious returned an error — try Cobalt fallback
    log.debug("Invidious error response, trying Cobalt fallback", { videoId, status: response.status });
    try {
      const cobaltResult = await getVideoFromCobalt(videoId);
      const minimalVideo = {
        videoId,
        title: videoId,
        author: "",
        lengthSeconds: 0,
        videoThumbnails: [],
        adaptiveFormats: [],
        recommendedVideos: [],
      } as unknown as Video;
      return { video: minimalVideo, ...cobaltResult };
    } catch {
      throw new Error(
        `Invidious API error: ${response.status} ${response.statusText}`,
      );
    }
  }

  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (parseErr) {
    log.fetchError("getVideo (JSON parse)", url, response, text, parseErr);
    throw new Error(
      `Invalid response from Invidious (check instance ${currentInstance.domain})`,
    );
  }

  if (data && typeof data === "object" && "error" in data && data.error) {
    // Invidious returned an API-level error — try Cobalt fallback
    log.debug("Invidious API error, trying Cobalt fallback", { videoId, error: (data as any).error });
    try {
      const cobaltResult = await getVideoFromCobalt(videoId);
      const minimalVideo = {
        videoId,
        title: videoId,
        author: "",
        lengthSeconds: 0,
        videoThumbnails: [],
        adaptiveFormats: [],
        recommendedVideos: [],
      } as unknown as Video;
      return { video: minimalVideo, ...cobaltResult };
    } catch {
      throw new Error(String((data as any).error));
    }
  }

  const video = data as Video & { formatStreams?: AdaptiveFormat[] };
  const formats =
    (video.adaptiveFormats?.length ?? 0) > 0
      ? video.adaptiveFormats!
      : video.formatStreams ?? [];

  if (!formats.length) {
    throw new Error("No adaptive formats available for this video");
  }

  const orderedFormats = selectAudioFormats(formats);

  if (orderedFormats.length === 0) {
    throw new Error("No playable audio stream found");
  }

  const urls = orderedFormats.map((f) => f.url).filter(Boolean);
  return { video, url: urls[0]!, fallbackUrls: urls.slice(1) };
};
