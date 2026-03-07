import type { Video } from "../types/interfaces/Video";
import { getThumbnailQuality } from "./formatData";

const DOMAIN_REGEX =
  /^(?:https?:\/\/)?(?:[^@/\n]+@)?(?:www\.)?([^:/?\\n]+\.+[^:/?\\n]+)/gm;

/** Normalize a thumbnail URL — strip domain to make it relative (stored without domain) */
const cleanThumbnailUrl = (url: string): string => {
  if (!url) return "";
  if (url.startsWith("/")) return url;

  // Guard against URLs where an absolute URL was concatenated onto an instance
  // domain, e.g. "https://instance.comhttps//i.ytimg.com/vi/ID/mqdefault.jpg".
  // Extract the embedded URL and normalise it recursively.
  const embeddedAbsolute = url.match(/https?:\/\/[^/]+?(https?:\/\/.+)$/i);
  if (embeddedAbsolute) return cleanThumbnailUrl(embeddedAbsolute[1]);

  // Same but malformed "https//" variant: "instance.comhttps//i.ytimg.com/..."
  const malformedIdx = url.search(/https?\/\//i);
  if (malformedIdx > 0) {
    const extracted = url.slice(malformedIdx).replace(/^(https?)\/\//, "$1://");
    return cleanThumbnailUrl(extracted);
  }

  if (/^https?:\/\//i.test(url)) return url.replace(DOMAIN_REGEX, "");
  // Malformed "https//..." - extract path portion
  if (/^https?\/\//i.test(url)) {
    const pathMatch = url.match(/^https?\/\/[^/]+(\/.*)?$/i);
    return pathMatch?.[1] ?? "";
  }
  return url;
};

/**
 * Sanitize a thumbnail URL for safe rendering at component level.
 *
 * Fixes malformed double-concatenated URLs already stored in the DB:
 *   "https://instance.comhttps//i.ytimg.com/vi/ID/mqdefault.jpg"
 *   "https://instance.comhttps//is1-ssl.mzstatic.com/image/..."
 *
 * Rules:
 *  - Embedded double-URL → extract and return the real inner URL
 *  - Relative path (/) + instanceUri → prepend instanceUri
 *  - Clean absolute URL → return as-is
 *  - Empty / unresolvable → fallback to YouTube CDN if videoId provided
 */
export const sanitizeThumbnailUrl = (
  url: string | undefined | null,
  instanceUri: string = "",
  fallbackVideoId?: string,
): string => {
  const ytFallback = fallbackVideoId
    ? `https://i.ytimg.com/vi/${fallbackVideoId}/mqdefault.jpg`
    : "";

  if (!url) return ytFallback;

  // Detect and unwrap double-URL: "https://instance.comhttps//..." or "https://instance.comhttps://..."
  const embeddedAbsolute = url.match(/https?:\/\/[^/]+?(https?:\/\/.+)$/i);
  if (embeddedAbsolute) {
    return sanitizeThumbnailUrl(embeddedAbsolute[1], instanceUri, fallbackVideoId);
  }

  // Malformed "https//" variant embedded after a domain
  const malformedIdx = url.search(/https?\/\//i);
  if (malformedIdx > 0) {
    const extracted = url.slice(malformedIdx).replace(/^(https?)\/\//, "$1://");
    return sanitizeThumbnailUrl(extracted, instanceUri, fallbackVideoId);
  }

  // Already a proper absolute URL — return as-is
  if (/^https?:\/\//i.test(url)) return url;

  // Relative path — prepend instance URI
  if (url.startsWith("/") && instanceUri) {
    return `${instanceUri.replace(/\/+$/, "")}${url}`;
  }

  return ytFallback || url;
};

export const cleanVideoThumbnailsUrl = (video: Video) => ({
  ...video,
  thumbnail: cleanThumbnailUrl(
    getThumbnailQuality(video.videoThumbnails, "maxresdefault"),
  ),
  videoThumbnails: video.videoThumbnails?.map((thumbnail) => ({
    ...thumbnail,
    url: cleanThumbnailUrl(thumbnail.url),
  })),
});
