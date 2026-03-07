/**
 * Trending service — Apple iTunes Charts Edition
 *
 * Uses Apple iTunes RSS charts as the sole source for trending music.
 * Fast (~150–300 ms), reliable, no Invidious dependency at load time.
 */

import { log } from "../utils/logger";
import type { TrendingFilters } from "../providers/TrendingFilters";
import type { CardVideo } from "../types/interfaces/Card";
import type { Instance } from "../types/interfaces/Instance";
import { getAppleTrending } from "./apple-charts";

// ─── In-memory cache ──────────────────────────────────────────────────────────

interface CacheEntry {
  data: CardVideo[];
  expiry: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000;

// ─── Public API ───────────────────────────────────────────────────────────────

export const getTrendings = async (
  instance: Instance,
  params: TrendingFilters,
): Promise<CardVideo[]> => {
  const region = (params.region ?? "US").toUpperCase().slice(0, 2);
  const cacheKey = `apple|${region}`;

  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) return cached.data;

  try {
    const appleData = await getAppleTrending(region.toLowerCase(), 25);
    if (appleData.length > 0) {
      cache.set(cacheKey, { data: appleData, expiry: Date.now() + CACHE_TTL_MS });
      return appleData;
    }
    log.warn("getTrendings: Apple Charts returned empty");
  } catch (err) {
    log.warn("getTrendings: Apple Charts failed", { err });
  }

  return [];
};
