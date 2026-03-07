/**
 * Apple iTunes RSS Charts Service — Fast Edition
 *
 * Performance: zero Invidious searches at load time.
 *
 * Tracks are returned as Apple Music virtual VideoIDs
 * (format: "am:0:encodedArtist:encodedTitle").
 * Resolution to a real YouTube stream only happens when the user presses Play,
 * via the existing usePlayVideo → resolveAppleMusicId flow.
 *
 * Load time: ~150–300 ms (single iTunes RSS fetch via Apple's global CDN).
 * Previously: 10+ seconds (N sequential Invidious searches per track).
 */

import { encodeAppleMusicVideoId } from "./appleMusic";
import { log } from "../utils/logger";
import type { CardVideo } from "../types/interfaces/Card";

// ─── In-memory cache ──────────────────────────────────────────────────────────

interface CacheEntry {
  data: CardVideo[];
  expiry: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ItunesImageEntry {
  label: string;
  attributes?: { height: string };
}

interface ItunesEntry {
  "im:name"?: { label: string };
  "im:artist"?: { label: string };
  "im:image"?: ItunesImageEntry[];
}

interface ItunesFeed {
  feed?: { entry?: ItunesEntry[] };
}

// ─── Supported iTunes storefronts ────────────────────────────────────────────

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
  const lower = country.toLowerCase().slice(0, 2);
  return SUPPORTED_ITUNES_COUNTRIES.has(lower) ? lower : "us";
};

// ─── Artwork helper ───────────────────────────────────────────────────────────

/** Pick the highest-quality iTunes RSS image and upgrade to 300 px */
const getBestArtwork = (images?: ItunesImageEntry[]): string => {
  if (!images?.length) return "";
  const best =
    images.find((img) => img.attributes?.height === "170") ??
    images[images.length - 1];
  const url = best?.label ?? "";
  return url ? url.replace(/\d+x\d+/, "300x300") : "";
};

// ─── iTunes RSS fetch ─────────────────────────────────────────────────────────

type ChartType = "topsongs" | "topalbums";

const fetchItunesChart = async (
  country: string,
  chart: ChartType,
  limit: number,
): Promise<ItunesEntry[]> => {
  const cc = normaliseCountry(country);
  const url = `/api/itunes-proxy/rss/${cc}/${chart}?limit=${limit}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        log.warn("apple-charts: iTunes RSS error", { status: res.status, cc, chart });
        return [];
      }
      const json: ItunesFeed = await res.json();
      return json?.feed?.entry ?? [];
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    log.warn("apple-charts: RSS fetch error", { err });
    return [];
  }
};

// ─── Convert RSS entries → virtual CardVideos (zero Invidious calls) ──────────

/**
 * Map iTunes RSS entries to CardVideos with Apple Music virtual IDs.
 *
 * trackId=0 is used as a stable placeholder — parseAppleMusicVideoId only
 * reads artist + title when constructing the Invidious search query at play time.
 */
const entriesToCards = (entries: ItunesEntry[]): CardVideo[] =>
  entries
    .map((entry): CardVideo | null => {
      const track = entry["im:name"]?.label?.trim() ?? "";
      const artist = entry["im:artist"]?.label?.trim() ?? "";
      if (!track || !artist) return null;
      return {
        type: "video",
        videoId: encodeAppleMusicVideoId(0, artist, track),
        title: `${track} — ${artist}`,
        thumbnail: getBestArtwork(entry["im:image"]),
        liveNow: false,
        lengthSeconds: 0,
        videoThumbnails: [],
      };
    })
    .filter((c): c is CardVideo => c !== null);

// ─── Public API ───────────────────────────────────────────────────────────────

/** Trending songs from Apple iTunes charts. Returns in ~200 ms, no Invidious needed. */
export const getAppleTrending = async (
  country: string | null,
  count = 25,
): Promise<CardVideo[]> => {
  const cc = normaliseCountry(country);
  const key = `trending|${cc}|${count}`;
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiry) return cached.data;
  try {
    const entries = await fetchItunesChart(cc, "topsongs", count);
    const data = entriesToCards(entries);
    if (data.length) cache.set(key, { data, expiry: Date.now() + CACHE_TTL_MS });
    return data;
  } catch (err) {
    log.warn("getAppleTrending failed", { err });
    return [];
  }
};

/** Popular songs from Apple iTunes charts. Returns in ~200 ms, no Invidious needed. */
export const getApplePopular = async (
  country: string | null,
  count = 25,
): Promise<CardVideo[]> => {
  const cc = normaliseCountry(country);
  const key = `popular|${cc}|${count}`;
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiry) return cached.data;
  try {
    const entries = await fetchItunesChart(cc, "topsongs", count);
    const data = entriesToCards(entries);
    if (data.length) cache.set(key, { data, expiry: Date.now() + CACHE_TTL_MS });
    return data;
  } catch (err) {
    log.warn("getApplePopular failed", { err });
    return [];
  }
};

// ─── Ollama context helper ────────────────────────────────────────────────────

/**
 * Fetch top songs from Apple Music charts as plain artist/title objects.
 * Used to enrich Ollama's recommendation context without any Invidious overhead.
 * Returns ~150 ms on a warm CDN.
 */
export const getAppleChartsForOllama = async (
  count = 8,
): Promise<Array<{ title: string; artist: string }>> => {
  try {
    const entries = await fetchItunesChart("us", "topsongs", count);
    return entries.map((e) => ({
      title: e["im:name"]?.label ?? "",
      artist: e["im:artist"]?.label ?? "",
    })).filter((t) => t.title && t.artist);
  } catch {
    return [];
  }
};
