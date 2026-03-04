/**
 * Apple iTunes RSS Charts Service
 *
 * Provides country-specific music charts via the iTunes Affiliate RSS feed.
 * URL: https://itunes.apple.com/{country}/rss/{chart}/limit={n}/json
 *
 * Supports 100+ country codes (ISO 3166-1 alpha-2 lowercase).
 * Falls back to "us" if the country code isn't supported.
 */

import { normalizeInstanceUri } from "../utils/invidiousInstance";
import { log } from "../utils/logger";
import type { CardVideo } from "../types/interfaces/Card";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ItunesEntry {
  "im:name"?: { label: string };
  "im:artist"?: { label: string };
  title?: { label: string };
  "im:image"?: { label: string; attributes?: { height: string } }[];
}

interface ItunesFeed {
  feed?: {
    entry?: ItunesEntry[];
  };
}

// ─── Country code normalisation ───────────────────────────────────────────────

/**
 * Countries supported by the iTunes RSS feed (not all ISO codes work).
 * We use a generous allow-list of well-known supported storefronts.
 */
const SUPPORTED_ITUNES_COUNTRIES = new Set([
  "ae","ag","ai","al","am","ao","ar","at","au","az","bb","be","bh","bj","bm",
  "bn","bo","br","bs","bt","bw","by","bz","ca","cg","ch","cl","cn","co","cr",
  "cv","cy","cz","de","dk","dm","do","dz","ec","ee","eg","es","fi","fj","fr",
  "gb","gd","gh","gm","gr","gt","gw","gy","hk","hn","hr","hu","id","ie","il",
  "in","is","it","jm","jo","jp","ke","kg","kh","kn","kr","kw","ky","kz","la",
  "lb","lc","lk","lr","lt","lu","lv","md","mg","mk","ml","mn","mo","mr","ms",
  "mt","mu","mw","mx","my","mz","na","ne","ng","ni","nl","no","np","nz","om",
  "pa","pe","pg","ph","pk","pl","pt","pw","py","qa","ro","ru","sa","sb","sc",
  "se","sg","si","sk","sl","sn","sr","st","sv","sz","tc","td","th","tj","tm",
  "tn","tr","tt","tw","tz","ua","ug","us","uy","uz","vc","ve","vg","vn","ye",
  "za","zw",
]);

const normaliseCountry = (country: string | null | undefined): string => {
  if (!country) return "us";
  const lower = country.toLowerCase();
  return SUPPORTED_ITUNES_COUNTRIES.has(lower) ? lower : "us";
};

// ─── Invidious search helper ──────────────────────────────────────────────────

const searchInvidious = async (
  baseUri: string,
  query: string,
): Promise<CardVideo | null> => {
  try {
    const url = `${baseUri}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance&page=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const results: any[] = Array.isArray(data) ? data : [];
    const video = results.find(
      (v) => v.type === "video" && v.videoId && v.lengthSeconds > 0 && !v.liveNow,
    );
    if (!video) return null;
    return {
      videoId: video.videoId,
      title: video.title ?? query,
      type: "video",
      thumbnail: video.videoThumbnails?.[0]?.url ?? "",
      liveNow: false,
      lengthSeconds: video.lengthSeconds ?? 0,
      videoThumbnails: video.videoThumbnails ?? [],
    } satisfies CardVideo;
  } catch (err) {
    log.warn("apple-charts: Invidious search failed", { query, err });
    return null;
  }
};

// ─── Chart fetcher ────────────────────────────────────────────────────────────

type ChartType = "topsongs" | "topalbums";

const fetchItunesChart = async (
  country: string,
  chart: ChartType,
  limit: number,
): Promise<{ artist: string; track: string }[]> => {
  const cc = normaliseCountry(country);
  const url = `https://itunes.apple.com/${cc}/rss/${chart}/limit=${limit}/json`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      log.warn("apple-charts: iTunes RSS error", { status: res.status, cc, chart });
      return [];
    }
    const json: ItunesFeed = await res.json();
    const entries = json?.feed?.entry ?? [];
    return entries
      .map((entry) => ({
        artist: entry["im:artist"]?.label ?? "",
        track: entry["im:name"]?.label ?? "",
      }))
      .filter((e) => e.artist && e.track);
  } catch (err) {
    log.warn("apple-charts: fetch error", { err });
    return [];
  }
};

// ─── Resolve tracks to CardVideos ─────────────────────────────────────────────

const resolveToCards = async (
  tracks: { artist: string; track: string }[],
  baseUri: string,
  limit: number,
  concurrency = 5,
): Promise<CardVideo[]> => {
  const items = tracks.slice(0, limit);
  const results: CardVideo[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const resolved = await Promise.all(
      batch.map((t) => searchInvidious(baseUri, `${t.artist} - ${t.track}`)),
    );
    for (const card of resolved) {
      if (card) results.push(card);
    }
  }
  return results;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch country-specific trending songs from Apple iTunes charts,
 * then resolve to playable CardVideos via Invidious.
 */
export const getAppleTrending = async (
  country: string | null,
  count = 25,
  instanceUri?: string,
): Promise<CardVideo[]> => {
  try {
    const baseUri = normalizeInstanceUri(instanceUri ?? "");
    if (!baseUri) {
      log.warn("getAppleTrending: no instance URI provided");
      return [];
    }
    const tracks = await fetchItunesChart(country ?? "us", "topsongs", count);
    if (!tracks.length) return [];
    return resolveToCards(tracks, baseUri, count);
  } catch (err) {
    log.warn("getAppleTrending failed", { err });
    return [];
  }
};

/**
 * Fetch country-specific popular songs from Apple iTunes charts,
 * then resolve to playable CardVideos via Invidious.
 */
export const getApplePopular = async (
  country: string | null,
  count = 25,
  instanceUri?: string,
): Promise<CardVideo[]> => {
  try {
    const baseUri = normalizeInstanceUri(instanceUri ?? "");
    if (!baseUri) {
      log.warn("getApplePopular: no instance URI provided");
      return [];
    }
    // Use topalbums for "popular" — tends to be the most iconic/established releases
    const tracks = await fetchItunesChart(country ?? "us", "topalbums", count);
    if (!tracks.length) return [];
    return resolveToCards(tracks, baseUri, count);
  } catch (err) {
    log.warn("getApplePopular failed", { err });
    return [];
  }
};
