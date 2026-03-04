/**
 * ListenBrainz Charts + Recommendations
 *
 * Flow:
 *  1. Fetch track list from ListenBrainz (sitewide charts or user recommendations)
 *  2. Resolve each "artist – track" to a YouTube video via Invidious search
 *  3. Return CardVideo[] ready to use in the UI
 */

import { normalizeInstanceUri } from "../utils/invidiousInstance";
import { getCurrentInstance } from "../utils/getCurrentInstance";
import { log } from "../utils/logger";
import type { CardVideo } from "../types/interfaces/Card";

const LB_API = "https://api.listenbrainz.org/1";

// ─── Types returned by ListenBrainz ──────────────────────────────────────────

interface LBRecording {
  artist_name: string;
  track_name: string;
  release_name?: string;
  listen_count?: number;
  recording_mbid?: string;
}

interface LBChartsResponse {
  payload: {
    recordings: LBRecording[];
    count: number;
    offset: number;
    range: string;
  };
}

interface LBRecommendationItem {
  recording_mbid: string;
  score: number;
  // LB returns extra metadata via mbid lookup — we resolve via search instead
  artist_name?: string;
  track_name?: string;
}

interface LBRecommendationsResponse {
  payload: {
    // LB uses artist_credit_name (not artist_name) in mbid_mapping
    mbid_mapping?: Record<string, { artist_credit_name?: string; artist_name?: string; recording_name: string }>;
    recordings?: LBRecommendationItem[];
  };
}

// ─── Invidious search helper ──────────────────────────────────────────────────

/**
 * Search Invidious for a single "Artist - Track" query and return the first
 * video result as a CardVideo. Returns null if nothing was found.
 */
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
      thumbnail:
        video.videoThumbnails?.[0]?.url ?? "",
      liveNow: false,
      lengthSeconds: video.lengthSeconds ?? 0,
      videoThumbnails: video.videoThumbnails ?? [],
    } satisfies CardVideo;
  } catch (err) {
    log.warn("listenbrainz-charts: Invidious search failed", { query, err });
    return null;
  }
};

/**
 * Resolve an array of LBRecording objects to CardVideos using Invidious search.
 * Runs up to `concurrency` searches in parallel.
 */
const resolveRecordings = async (
  recordings: LBRecording[],
  baseUri: string,
  limit = 20,
  concurrency = 5,
): Promise<CardVideo[]> => {
  const items = recordings.slice(0, limit);
  const results: CardVideo[] = [];

  // Process in batches to avoid hammering the instance
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const resolved = await Promise.all(
      batch.map((rec) => {
        const q = `${rec.artist_name} - ${rec.track_name}`;
        return searchInvidious(baseUri, q);
      }),
    );
    for (const card of resolved) {
      if (card) results.push(card);
    }
  }

  return results;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch sitewide trending music from ListenBrainz for the given time range,
 * then resolve to playable CardVideos via Invidious.
 */
export const getLBTrending = async (
  range: "week" | "month" | "year" | "all_time" = "week",
  count = 25,
): Promise<CardVideo[]> => {
  try {
    const instance = getCurrentInstance();
    const baseUri = normalizeInstanceUri(instance.uri);

    const url = `${LB_API}/stats/sitewide/recordings?count=${count}&range=${range}`;
    const res = await fetch(url);
    if (!res.ok) {
      log.warn("getLBTrending: ListenBrainz API error", { status: res.status });
      return [];
    }
    const json: LBChartsResponse = await res.json();
    const recordings = json?.payload?.recordings ?? [];
    if (!recordings.length) return [];

    return resolveRecordings(recordings, baseUri, count);
  } catch (err) {
    log.warn("getLBTrending failed", { err });
    return [];
  }
};

/**
 * Fetch sitewide popular music (all_time charts) from ListenBrainz,
 * then resolve to playable CardVideos via Invidious.
 */
export const getLBPopular = async (count = 25): Promise<CardVideo[]> => {
  return getLBTrending("month", count);
};

/**
 * Fallback: fetch the user's own top tracks from the past month.
 * Used when CF recommendations return no resolvable metadata.
 */
const getLBUserTopTracks = async (
  username: string,
  userToken: string,
  baseUri: string,
  count: number,
): Promise<CardVideo[]> => {
  try {
    const url = `${LB_API}/stats/user/${encodeURIComponent(username)}/recordings?count=${count}&range=month`;
    const res = await fetch(url, {
      headers: { Authorization: `Token ${userToken}` },
    });
    if (!res.ok) return [];
    const json: LBChartsResponse = await res.json();
    const recordings = json?.payload?.recordings ?? [];
    if (!recordings.length) return [];
    return resolveRecordings(recordings, baseUri, count);
  } catch (err) {
    log.warn("getLBUserTopTracks failed", { err });
    return [];
  }
};

/**
 * Fetch personalised collaborative-filtering recommendations for a ListenBrainz
 * user, then resolve to playable CardVideos via Invidious.
 * Requires a valid username — returns [] if not connected.
 */
export const getLBRecommendations = async (
  username: string,
  userToken: string,
  count = 20,
): Promise<CardVideo[]> => {
  if (!username || !userToken) return [];

  try {
    const instance = getCurrentInstance();
    const baseUri = normalizeInstanceUri(instance.uri);

    // CF recommendations endpoint
    const url = `${LB_API}/recommendations/cf/recording/for_user/${encodeURIComponent(username)}?count=${count}`;
    const res = await fetch(url, {
      headers: { Authorization: `Token ${userToken}` },
    });
    if (!res.ok) {
      log.warn("getLBRecommendations: API error", { status: res.status });
      return [];
    }
    const json: LBRecommendationsResponse = await res.json();
    const items = json?.payload?.recordings ?? [];
    const mapping = json?.payload?.mbid_mapping ?? {};

    // Build LBRecording list from mbid_mapping if available
    const recordings: LBRecording[] = items
      .map((item) => {
        const meta = mapping[item.recording_mbid];
        // LB API uses artist_credit_name (or artist_name as fallback)
        const artistName = meta?.artist_credit_name ?? meta?.artist_name;
        if (!meta || !artistName || !meta?.recording_name) return null;
        return {
          artist_name: artistName,
          track_name: meta.recording_name,
        } satisfies LBRecording;
      })
      .filter((r): r is LBRecording => r !== null);

    if (!recordings.length) {
      // Fallback: use the user's own top tracks from the past month as "recommendations"
      log.warn("getLBRecommendations: CF returned no resolvable tracks, falling back to user stats");
      return getLBUserTopTracks(username, userToken, baseUri, count);
    }

    return resolveRecordings(recordings, baseUri, count);
  } catch (err) {
    log.warn("getLBRecommendations failed", { err });
    return [];
  }
};

// ─── "Created For You" playlists (Recommendations page) ──────────────────────

export interface LBPlaylistTrack {
  identifier: string; // MBID URI
  title: string;
  creator: string;    // artist name
  duration?: number;  // ms
  extension?: {
    "https://musicbrainz.org/doc/jspf#track"?: {
      added_by?: string;
      score?: number;
    };
  };
}

export interface LBPlaylist {
  identifier: string;  // playlist MBID URI
  title: string;
  annotation?: string; // description HTML
  creator: string;     // username who generated it
  date: string;        // ISO date
  track: LBPlaylistTrack[];
  extension?: {
    "https://musicbrainz.org/doc/jspf#playlist"?: {
      public?: boolean;
      additional_metadata?: {
        algorithm_metadata?: { source_patch?: string };
      };
    };
  };
}

interface LBPlaylistsResponse {
  playlists: Array<{ playlist: LBPlaylist }>;
  count: number;
  offset: number;
  playlist_count: number;
}

/**
 * Fetch auto-generated "Created For You" playlist stubs from ListenBrainz.
 * The /createdfor endpoint returns playlist metadata but tracks[] is EMPTY —
 * you must call getLBPlaylistWithTracks(uuid, token) separately to get tracks.
 *
 * Endpoint: GET /1/user/{username}/playlists/createdfor
 * Requires Authorization: Token {userToken}
 */
export const getLBCreatedForYouPlaylists = async (
  username: string,
  userToken: string,
  count = 10,
): Promise<LBPlaylist[]> => {
  if (!username || !userToken) return [];
  try {
    const url = `${LB_API}/user/${encodeURIComponent(username)}/playlists/createdfor?count=${count}`;
    const res = await fetch(url, {
      headers: { Authorization: `Token ${userToken}` },
    });
    if (!res.ok) {
      log.warn("getLBCreatedForYouPlaylists: API error", { status: res.status });
      return [];
    }
    const json: LBPlaylistsResponse = await res.json();
    return (json?.playlists ?? []).map((p) => p.playlist);
  } catch (err) {
    log.warn("getLBCreatedForYouPlaylists failed", { err });
    return [];
  }
};

/**
 * Fetch a single playlist's FULL content (including all tracks) by UUID.
 *
 * The /createdfor listing endpoint returns stub playlists with 0 tracks.
 * This endpoint returns the complete playlist with its track list.
 *
 * Endpoint: GET /1/playlist/{playlist_mbid}
 * Requires Authorization: Token {userToken}
 */
export const getLBPlaylistWithTracks = async (
  playlistUuid: string,
  userToken: string,
): Promise<LBPlaylist | null> => {
  if (!playlistUuid || !userToken) return null;
  try {
    const url = `${LB_API}/playlist/${encodeURIComponent(playlistUuid)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Token ${userToken}` },
    });
    if (!res.ok) {
      log.warn("getLBPlaylistWithTracks: API error", { status: res.status, uuid: playlistUuid });
      return null;
    }
    const json = await res.json();
    // Response shape: { playlist: LBPlaylist }
    return (json?.playlist as LBPlaylist) ?? null;
  } catch (err) {
    log.warn("getLBPlaylistWithTracks failed", { err, uuid: playlistUuid });
    return null;
  }
};

/**
 * Resolve the tracks from a single LB playlist to playable CardVideos.
 * Takes the first `limit` tracks and searches Invidious for each.
 */
export const resolvePlaylistTracks = async (
  tracks: LBPlaylistTrack[],
  limit = 20,
): Promise<CardVideo[]> => {
  try {
    const instance = getCurrentInstance();
    const baseUri = normalizeInstanceUri(instance.uri);
    const recordings: LBRecording[] = tracks.slice(0, limit).map((t) => ({
      artist_name: t.creator,
      track_name:  t.title,
    }));
    return resolveRecordings(recordings, baseUri, limit);
  } catch (err) {
    log.warn("resolvePlaylistTracks failed", { err });
    return [];
  }
};
