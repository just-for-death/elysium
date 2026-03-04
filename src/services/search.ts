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
    return searchAppleMusic(params.q) as Promise<Card[]>;
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
