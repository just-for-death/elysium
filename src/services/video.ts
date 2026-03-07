import { getSettings } from "../database/utils";
import type { AdaptiveFormat, Video } from "../types/interfaces/Video";
import { normalizeInstanceUri } from "../utils/invidiousInstance";
import { log } from "../utils/logger";
import { userAgent } from "../utils/userAgent";

// ─── Platform detection ────────────────────────────────────────────────────
// iOS/iPadOS (including Firefox iOS and all iOS browsers) uses WebKit which
// has ZERO support for WebM/Opus. Feeding it audio/webm causes garbled
// duration (e.g. 7 min reported for a 3 min song) or complete silence.
// We MUST serve only audio/mp4 (AAC) on Apple devices.
//
// BUG FIX: Do NOT use `userAgent.engine?.name === "WebKit"` as a sole signal.
// UAParser reports engine "WebKit" for Android Chrome too (Blink is derived
// from WebKit and the UA string still contains "AppleWebKit/…"). This caused
// Android Chrome to be treated as iOS, giving it AAC-only audio and the
// iOS-specific canplay autoplay flow, breaking playback entirely on Android.
//
// Correct detection: require an explicit Apple OS or Apple device signal.
export const isAppleWebKit: boolean = (() => {
  try {
    const ua = navigator.userAgent;
    // Explicit iOS/iPadOS device UA tokens
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    // iPadOS 13+ reports as MacIntel with touch support
    if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
    // UAParser OS name (reliable, doesn't fire on Android)
    if (userAgent.os?.name === "iOS" || userAgent.os?.name === "Mac OS") {
      // Mac OS desktops don't need WebKit audio workarounds — only touch Macs (iPads)
      if (userAgent.os?.name === "Mac OS" && navigator.maxTouchPoints < 1) return false;
      return true;
    }
    return false;
  } catch {
    return false;
  }
})();

// Separate flag for Android — used to tune audio startup behaviour.
// Android Chrome supports WebM/Opus natively and handles autoplay differently
// from both iOS and desktop. We keep this detection explicit and narrow.
export const isAndroidChrome: boolean = (() => {
  try {
    return (
      userAgent.os?.name === "Android" ||
      /Android/.test(navigator.userAgent)
    );
  } catch {
    return false;
  }
})();

// ─── YouTube itag registry ─────────────────────────────────────────────────
// Using itag as ground truth is more reliable than parsing the type string,
// because some Invidious instances mislabel or omit the type field entirely.
const AUDIO_ONLY_ITAGS = new Set([
  "139", "140", "141",           // AAC LC (MP4): 48k, 128k, 256k
  "256", "258",                  // AAC HE (MP4): 192k, 384k
  "249", "250", "251",           // Opus (WebM): 50k, 70k, 160k
  "327",                         // AAC (MP4) for live streams
  "338",                         // Opus (WebM) 4ch
]);

// On WebKit (iOS/iPadOS): ONLY AAC in MP4 container works correctly.
// WebM/Opus will either silently fail, report a wrong duration, or play
// corrupted audio on every iOS browser (Safari, Chrome, Firefox — all WebKit).
const WEBKIT_SAFE_ITAGS = new Set(["139", "140", "141", "256", "258", "327"]);

const parseBitrate = (bitrate: string | undefined): number => {
  const match = /(\d+)/.exec(String(bitrate || ""));
  return match ? parseInt(match[1], 10) : 0;
};

/**
 * Select audio-only formats from Invidious adaptiveFormats.
 *
 * Strategy (in order of reliability):
 * 1. Match by itag — most reliable, bypasses type string issues
 * 2. Match by type string starting with "audio/" — catches unlisted itags
 * 3. NEVER include video/* types — they cause wrong duration on iOS
 *
 * On WebKit (iOS/iPadOS): only return AAC/MP4 formats (no WebM/Opus).
 */
const selectAudioFormats = (formats: AdaptiveFormat[]): AdaptiveFormat[] => {
  const withUrl = formats.filter((f) => f?.url && typeof f.url === "string");
  if (withUrl.length === 0) return [];

  // Pass 1: known audio-only itags
  const byItag = withUrl.filter((f) => {
    if (!f.itag) return false;
    if (isAppleWebKit) return WEBKIT_SAFE_ITAGS.has(String(f.itag));
    return AUDIO_ONLY_ITAGS.has(String(f.itag));
  });

  // Pass 2: type string starts with "audio/" (catches non-standard itags)
  const byType = withUrl.filter((f) => {
    if (!f.type) return false;
    if (!/^audio\//i.test(f.type)) return false;
    // On WebKit: reject WebM/Opus even if labeled as audio/
    if (isAppleWebKit && /webm|opus/i.test(f.type)) return false;
    return true;
  });

  // Merge, deduplicate, itag matches first
  const seen = new Set<AdaptiveFormat>();
  const pool: AdaptiveFormat[] = [];
  for (const f of [...byItag, ...byType]) {
    if (!seen.has(f)) { pool.push(f); seen.add(f); }
  }

  if (pool.length === 0) {
    log.debug("selectAudioFormats: no audio-only formats found", {
      isAppleWebKit,
      sampleTypes: withUrl.slice(0, 5).map((f) => `${f.itag}:${f.type}`),
    });
    return [];
  }

  // Sort: on WebKit put itag 140 (128kbps AAC LC) FIRST for fastest startup.
  // Rationale: iOS WebKit must buffer a fixed number of seconds before canplay
  // fires. At 128kbps that's 16KB/s; at 256kbps it's 32KB/s. So WebKit needs
  // to download TWICE as much data before starting at higher bitrate — directly
  // causing the "slow startup" on iPad, especially on cellular or weak WiFi.
  // 128kbps AAC LC is perceptually transparent on iPad speakers/headphones.
  // Higher bitrates remain available as ordered fallbacks.
  // On desktop: prefer Opus (better codec) then highest AAC bitrate as before.
  const sorted = [...pool].sort((a, b) => {
    if (isAppleWebKit) {
      // itag 140 = 128kbps AAC LC: fastest-starting format on iOS
      const aFast = String(a.itag) === "140" ? 1 : 0;
      const bFast = String(b.itag) === "140" ? 1 : 0;
      if (aFast !== bFast) return bFast - aFast;
      // For the rest, prefer lower bitrate to keep startup fast
      return parseBitrate(a.bitrate) - parseBitrate(b.bitrate);
    }
    // Non-iOS: prefer Opus (WebM) over AAC for better quality on Firefox/Chrome
    const aOpus = /opus|webm/i.test(a.type || "") ? 1 : 0;
    const bOpus = /opus|webm/i.test(b.type || "") ? 1 : 0;
    if (aOpus !== bOpus) return bOpus - aOpus;
    return parseBitrate(b.bitrate) - parseBitrate(a.bitrate);
  });

  log.debug("selectAudioFormats result", {
    isAppleWebKit,
    total: formats.length,
    audioPool: pool.length,
    selected: sorted[0]?.itag,
    type: sorted[0]?.type,
    bitrate: sorted[0]?.bitrate,
  });

  return sorted;
};

// ─── API URL builder ───────────────────────────────────────────────────────
const buildVideoApiUrl = (
  baseUri: string,
  videoId: string,
  region?: string,
): string => {
  const url = new URL(`${baseUri}/api/v1/videos/${videoId}`);
  // Region hint for geo-restricted content (ISO 3166 country code)
  if (region?.length === 2) url.searchParams.set("region", region);
  // local=true: proxied stream URLs bound to instance IP, not client IP.
  // Without this YouTube returns 403 because signed URLs are IP-locked.
  url.searchParams.set("local", "true");
  return url.toString();
};

// ─── Cobalt fallback ───────────────────────────────────────────────────────
// NOTE: Cobalt is NOT used on iOS/WebKit — it returns video streams or
// redirects to YouTube which iOS cannot play cross-origin without CORS.
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
        headers: { "Content-Type": "application/json", Accept: "application/json" },
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
      if (
        (data.status === "stream" || data.status === "redirect" || data.status === "tunnel") &&
        data.url
      ) {
        log.debug("Cobalt fallback succeeded", { videoId, instance, status: data.status });
        return { url: data.url, fallbackUrls: [] };
      }
    } catch (err) {
      log.debug("Cobalt instance failed", { instance, err });
    }
  }

  throw new Error("Cobalt fallback failed: no working instance found");
};

// ─── Main export ───────────────────────────────────────────────────────────
export const getVideo = async (
  videoId: string,
): Promise<{ video: Video; url: string; fallbackUrls: string[] }> => {
  const { currentInstance } = getSettings();

  if (!currentInstance?.uri) {
    throw new Error("No Invidious instance configured");
  }

  const baseUri = normalizeInstanceUri(currentInstance.uri);
  const apiUrl = buildVideoApiUrl(baseUri, videoId, currentInstance.region);

  log.debug("getVideo fetch", {
    videoId,
    apiUrl,
    isAppleWebKit,
    instance: currentInstance.domain,
  });

  const makeMinimalVideo = (): Video =>
    ({
      videoId,
      title: videoId,
      author: "",
      lengthSeconds: 0,
      videoThumbnails: [],
      adaptiveFormats: [],
      recommendedVideos: [],
    }) as unknown as Video;

  // ── Fetch from Invidious ──────────────────────────────────────────────
  let response: Response;
  try {
    // iPad/iOS on cellular can be slower — use 12s timeout (was 6s) to
    // avoid false network errors that trigger unnecessary fallback retries.
    response = await fetch(apiUrl, { signal: AbortSignal.timeout(12000) });
  } catch (networkErr) {
    log.debug("Invidious unreachable", { videoId, networkErr });
    // iOS: Cobalt returns video streams iOS can't play — surface a clear error
    if (isAppleWebKit) {
      throw new Error(
        "Cannot reach music server. Check your Invidious instance in Settings.",
      );
    }
    return { video: makeMinimalVideo(), ...(await getVideoFromCobalt(videoId)) };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    log.fetchError("getVideo", apiUrl, response, body);
    if (isAppleWebKit) {
      throw new Error(`Music server error ${response.status}. Try a different Invidious instance.`);
    }
    log.debug("Invidious error response, trying Cobalt fallback", { videoId, status: response.status });
    try {
      return { video: makeMinimalVideo(), ...(await getVideoFromCobalt(videoId)) };
    } catch {
      throw new Error(`Invidious API error: ${response.status} ${response.statusText}`);
    }
  }

  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (parseErr) {
    log.fetchError("getVideo (JSON parse)", apiUrl, response, text, parseErr);
    throw new Error(
      `Invalid response from Invidious (check instance ${currentInstance.domain})`,
    );
  }

  if (data && typeof data === "object" && "error" in data && (data as any).error) {
    const errMsg = String((data as any).error);
    log.debug("Invidious API error field", { videoId, errMsg });
    if (isAppleWebKit) {
      throw new Error(errMsg);
    }
    log.debug("Invidious API error, trying Cobalt fallback", { videoId, error: errMsg });
    try {
      return { video: makeMinimalVideo(), ...(await getVideoFromCobalt(videoId)) };
    } catch {
      throw new Error(errMsg);
    }
  }

  // ── Parse formats ─────────────────────────────────────────────────────
  const video = data as Video & { formatStreams?: AdaptiveFormat[] };

  // adaptiveFormats = audio-only + video-only DASH streams (what we want)
  // formatStreams   = muxed video+audio streams (fallback, avoid on iOS —
  //                  muxed streams report wrong duration on WebKit)
  const adaptiveFormats = video.adaptiveFormats ?? [];
  const formatStreams = (video as any).formatStreams ?? [];

  log.debug("getVideo formats", {
    adaptiveCount: adaptiveFormats.length,
    formatStreamCount: formatStreams.length,
    adaptiveSample: adaptiveFormats.slice(0, 3).map((f: AdaptiveFormat) => `${f.itag}:${f.type}`),
  });

  // Try adaptive formats first (audio-only DASH)
  const orderedFormats = selectAudioFormats(adaptiveFormats);

  if (orderedFormats.length > 0) {
    const urls = orderedFormats.map((f) => f.url).filter(Boolean);
    return { video, url: urls[0]!, fallbackUrls: urls.slice(1) };
  }

  // No audio-only adaptive formats found.
  // On iOS: DO NOT use formatStreams (muxed = wrong duration) or Cobalt.
  // Throw a clear error so the user knows to switch Invidious instance.
  if (isAppleWebKit) {
    throw new Error(
      "No audio-only streams available from this Invidious instance. " +
      "Try switching to a different instance in Settings.",
    );
  }

  // Non-iOS: try Cobalt as last resort
  log.debug("No audio-only adaptive formats, trying Cobalt", { videoId });
  try {
    return { video, ...(await getVideoFromCobalt(videoId)) };
  } catch {
    throw new Error("No playable audio stream found");
  }
};
