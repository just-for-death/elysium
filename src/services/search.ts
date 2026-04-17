import qs from "qs";

import type { Card } from "../types/interfaces/Card";
import type { Search } from "../types/interfaces/Search";
import { getCurrentInstance } from "../utils/getCurrentInstance";
import { normalizeInstanceUri } from "../utils/invidiousInstance";
import { log } from "../utils/logger";
import { searchAppleMusic } from "./appleMusic";

interface SearchParams extends Search {
  page: number;
}

export const search = async ({
  sortBy: sort_by,
  ...params
}: SearchParams): Promise<Card[]> => {
  // Apple Music search is handled client-side via the iTunes API
  if (params.service === "apple_music") {
    try {
      const results = await searchAppleMusic(params.q);
      if (results.length > 0) return results as Card[];
    } catch {
      // fall through to Invidious
    }
    // If Apple Music fails (403/rate-limited), fall back to Invidious search.
    // getCurrentInstance() throws when no instance is configured, so guard it.
    let instance;
    try {
      instance = getCurrentInstance();
    } catch {
      return [];
    }
    const uri = `${normalizeInstanceUri(instance.uri)}/api/v1/search`;
    const url = `${uri}?${qs.stringify({ q: params.q, type: "video", sort_by: "relevance", page: 1 })}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data)) return [];
      // Map raw Invidious video objects to CardVideo shape
      return data
        .filter((v: any) => v.type === "video" && v.videoId)
        .map((v: any): Card => ({
          type: "video",
          videoId: v.videoId,
          title: v.title ?? "",
          thumbnail: v.videoThumbnails?.[0]?.url
            ? `/vi/${v.videoId}/mqdefault.jpg`
            : `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
          liveNow: v.liveNow ?? false,
          lengthSeconds: v.lengthSeconds ?? 0,
          videoThumbnails: v.videoThumbnails ?? [],
        }));
    } catch (err) {
      log.warn("search: Apple Music + Invidious both failed", { err });
      return [];
    }
  }

  const instance = getCurrentInstance();
  let uri: string | null = null;

  switch (params.service) {
    case "invidious":
      uri = `${normalizeInstanceUri(instance.uri)}/api/v1/search`;
      break;
    case "youtube_music":
      uri = `${process.env.REACT_APP_API_URL ?? ""}/api/ytMusic/search`;
      break;
    default:
      throw new Error("Invalid service");
  }

  // Build query params — strip internal-only fields that Invidious doesn't accept
  // (sending unknown params like "service" causes HTTP 400 Bad Request)
  const { service: _service, ...invidiousParams } = params;
  const url = `${uri}?${qs.stringify({ ...invidiousParams, sort_by })}`;
  try {
    const response = await fetch(url);
    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      log.fetchError("search", url, response, text, parseErr);
      return [];
    }
    return Array.isArray(data) ? data : [];
  } catch (err) {
    log.warn("search failed", { url, err });
    return [];
  }
};
