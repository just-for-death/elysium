/**
 * Popular service — Apple iTunes Charts Edition
 *
 * Uses Apple iTunes RSS charts as the sole source for popular music.
 * Fast (~150–300 ms), reliable, no Invidious dependency at load time.
 */

import { log } from "../utils/logger";
import type { CardVideo } from "../types/interfaces/Card";
import type { Instance } from "../types/interfaces/Instance";
import { getApplePopular } from "./apple-charts";

// ─── In-memory cache ──────────────────────────────────────────────────────────

interface CacheEntry {
  data: CardVideo[];
  expiry: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000;

// ─── Public API ───────────────────────────────────────────────────────────────

export const getPopulars = async (
  _instance: Instance,
  country: string | null = null,
): Promise<CardVideo[]> => {
  const region = (country ?? "US").toUpperCase().slice(0, 2);
  const cacheKey = `apple|${region}`;

  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) return cached.data;

  try {
    const appleData = await getApplePopular(country, 30);
    if (appleData.length > 0) {
      cache.set(cacheKey, { data: appleData, expiry: Date.now() + CACHE_TTL_MS });
    }
    return appleData;
  } catch (err) {
    log.warn("getPopulars: Apple Charts failed", { err });
    return [];
  }
};

/** @deprecated Typo alias kept for backwards compatibility. Use {@link getPopulars}. */
export const getPopuplars = getPopulars;
