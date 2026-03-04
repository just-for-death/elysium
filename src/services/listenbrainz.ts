// ListenBrainz Scrobbling Service
// Uses ListenBrainz API v1 with User Token authentication
// Docs: https://listenbrainz.readthedocs.io/en/latest/users/api/core.html
// JSON format: https://listenbrainz.readthedocs.io/en/latest/users/json.html

const LISTENBRAINZ_API_URL = "https://api.listenbrainz.org/1";
const SUBMISSION_CLIENT = "Elysium";
const SUBMISSION_CLIENT_VERSION = "1.12.3";

// LISTEN_MINIMUM_TS: minimum accepted value for listened_at (Jan 3, 2003)
const LISTEN_MINIMUM_TS = 1033430400;

export interface ListenBrainzCredentials {
  userToken: string;
  username: string;
}

export interface ListenBrainzTrackMetadata {
  artist_name: string;
  track_name: string;
  release_name?: string;
  duration_ms?: number;
  additional_info?: {
    music_service?: string;
    origin_url?: string;
    youtube_id?: string;
  };
}

/** Build additional_info per ListenBrainz Client Metadata examples (youtube.com domain) */
function buildAdditionalInfo(metadata: ListenBrainzTrackMetadata): Record<string, unknown> {
  return {
    media_player: SUBMISSION_CLIENT,
    music_service: "youtube.com", // Canonical domain per docs
    music_service_name: "YouTube",
    submission_client: SUBMISSION_CLIENT,
    submission_client_version: SUBMISSION_CLIENT_VERSION,
    ...(metadata.duration_ms ? { duration_ms: metadata.duration_ms } : {}),
    ...metadata.additional_info,
  };
}

// Validate a user token
// Response: { code: 200, valid: true, user_name: "..." } or { code: 200, valid: false }
export async function validateListenBrainzToken(token: string): Promise<{ valid: boolean; username?: string }> {
  try {
    const res = await fetch(`${LISTENBRAINZ_API_URL}/validate-token`, {
      headers: {
        Authorization: `Token ${token}`,
      },
    });
    const data = await res.json();
    // API returns user_name (underscore) in valid response
    if (res.ok && data.valid === true) {
      return { valid: true, username: data.user_name };
    }
    return { valid: false };
  } catch {
    return { valid: false };
  }
}

// Submit a "playing now" listen (no listened_at; optional per API)
export async function submitPlayingNow(
  credentials: ListenBrainzCredentials,
  metadata: ListenBrainzTrackMetadata
): Promise<void> {
  const payload = {
    listen_type: "playing_now",
    payload: [
      {
        track_metadata: {
          artist_name: metadata.artist_name,
          track_name: metadata.track_name,
          ...(metadata.release_name ? { release_name: metadata.release_name } : {}),
          additional_info: buildAdditionalInfo(metadata),
        },
      },
    ],
  };

  try {
    const res = await fetch(`${LISTENBRAINZ_API_URL}/submit-listens`, {
      method: "POST",
      headers: {
        Authorization: `Token ${credentials.userToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    // submit-listens returns 200 OK with { status: "ok" } on success
    if (!res.ok || (data.status !== "ok" && data.code !== 200)) {
      console.warn("[ListenBrainz] Playing Now error:", data.error ?? data.message ?? res.statusText);
    }
  } catch (err) {
    console.warn("[ListenBrainz] Playing Now fetch error:", err);
  }
}

// Submit a single scrobble (listen)
// listened_at: Unix timestamp when playback started (required for "single")
export async function submitListen(
  credentials: ListenBrainzCredentials,
  metadata: ListenBrainzTrackMetadata,
  listenedAt: number
): Promise<void> {
  const clampedTs = Math.max(listenedAt, LISTEN_MINIMUM_TS);

  const payload = {
    listen_type: "single",
    payload: [
      {
        listened_at: clampedTs,
        track_metadata: {
          artist_name: metadata.artist_name,
          track_name: metadata.track_name,
          ...(metadata.release_name ? { release_name: metadata.release_name } : {}),
          additional_info: buildAdditionalInfo(metadata),
        },
      },
    ],
  };

  try {
    const res = await fetch(`${LISTENBRAINZ_API_URL}/submit-listens`, {
      method: "POST",
      headers: {
        Authorization: `Token ${credentials.userToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || (data.status !== "ok" && data.code !== 200)) {
      console.warn("[ListenBrainz] Scrobble error:", data.error ?? data.message ?? res.statusText);
    } else {
      console.info("[ListenBrainz] Scrobbled:", metadata.artist_name, "-", metadata.track_name);
    }
  } catch (err) {
    console.warn("[ListenBrainz] Scrobble fetch error:", err);
  }
}

// Parse video title into artist/track (best-effort heuristic for YouTube titles)
export function parseArtistTrack(
  title: string,
  author: string
): { artist: string; track: string } {
  if (!title?.trim()) {
    return { artist: author || "Unknown", track: "Unknown" };
  }

  // Clean up common YouTube suffixes and quality labels
  const cleanTitle = title
    .replace(/\s*\(Official\s*(Music\s*)?(Video|Audio|Lyric(s)?|Visualizer)?\)/gi, "")
    .replace(/\s*\[Official\s*(Music\s*)?(Video|Audio|Lyric(s)?|Visualizer)?\]/gi, "")
    .replace(/\s*(Official\s*)?(Music\s*)?(Video|Audio|Lyric(s)? Video)\s*$/gi, "")
    .replace(/\s*\(.*?HD.*?\)/gi, "")
    .replace(/\s*\[.*?HD.*?\]/gi, "")
    .replace(/\s*[\|\-]\s*\[.*?\]\s*$/g, "") // Trailing [Official] etc.
    .replace(/\s*\((\d{4})\)\s*$/g, "") // Trailing (2024) year
    .trim();

  // Common separators: "Artist - Track", "Artist – Track", "Artist — Track"
  const separators = [" – ", " — ", " - ", " | "];
  for (const sep of separators) {
    const idx = cleanTitle.indexOf(sep);
    if (idx > 0) {
      const artist = cleanTitle.slice(0, idx).trim();
      const track = cleanTitle.slice(idx + sep.length).trim();
      if (artist && track) {
        return { artist, track };
      }
    }
  }

  // Fall back to channel name as artist (clean -Topic, VEVO, etc.)
  const cleanAuthor = (author || "")
    .replace(/\s*-\s*Topic\s*$/i, "")
    .replace(/\s*VEVO\s*$/i, "")
    .replace(/\s*Official\s*$/i, "")
    .trim() || "Unknown";

  return { artist: cleanAuthor, track: cleanTitle || "Unknown" };
}

// ─── Stats / history helpers ───────────────────────────────────────────────

export interface LBListen {
  listened_at: number;
  track_metadata: {
    artist_name: string;
    track_name: string;
    release_name?: string;
    mbid_mapping?: {
      release_mbid?: string;
      recording_mbid?: string;
      artist_mbids?: string[];
      caa_id?: number;
      caa_release_mbid?: string;
    };
  };
}

export interface LBTopRecording {
  artist_name: string;
  track_name: string;
  listen_count: number;
  release_name?: string;
  release_mbid?: string;
  recording_mbid?: string;
  artist_mbids?: string[];
  caa_id?: number;
  caa_release_mbid?: string;
}

/** Build a Cover Art Archive thumbnail URL from MBID mapping data */
export function getCoverArtUrl(
  caaMbid?: string,
  caaId?: number,
  size: 250 | 500 = 250,
): string | null {
  if (caaMbid && caaId) {
    return `https://coverartarchive.org/release/${caaMbid}/${caaId}-${size}.jpg`;
  }
  if (caaMbid) {
    return `https://coverartarchive.org/release/${caaMbid}/front-${size}`;
  }
  return null;
}

/** Fetch the user's recent listens */
export async function getRecentListens(
  credentials: ListenBrainzCredentials,
  count = 10,
): Promise<LBListen[]> {
  try {
    const res = await fetch(
      `${LISTENBRAINZ_API_URL}/user/${encodeURIComponent(credentials.username)}/listens?count=${count}`,
      { headers: { Authorization: `Token ${credentials.userToken}` } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data?.payload?.listens ?? [];
  } catch {
    return [];
  }
}

/** Fetch the user's top recordings for a given time range */
export async function getTopRecordings(
  credentials: ListenBrainzCredentials,
  range: "week" | "month" | "year" | "all_time" = "month",
  count = 10,
): Promise<LBTopRecording[]> {
  try {
    const res = await fetch(
      `${LISTENBRAINZ_API_URL}/stats/user/${encodeURIComponent(credentials.username)}/recordings?count=${count}&range=${range}`,
      { headers: { Authorization: `Token ${credentials.userToken}` } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data?.payload?.recordings ?? [];
  } catch {
    return [];
  }
}

// ─── Playlist Creation ─────────────────────────────────────────────────────

export interface LBPlaylistTrack {
  videoId: string;
  title: string;
  author?: string;
}

export interface LBCreatePlaylistResult {
  success: boolean;
  playlistMbid?: string;
  playlistUrl?: string;
  error?: string;
}

/**
 * Create a ListenBrainz playlist from a list of YouTube videos.
 * Uses JSPF format (JSON Playlist Format).
 * Docs: https://listenbrainz.readthedocs.io/en/latest/users/api/playlist.html
 */
export async function createListenBrainzPlaylist(
  credentials: ListenBrainzCredentials,
  playlistTitle: string,
  tracks: LBPlaylistTrack[],
  description?: string,
): Promise<LBCreatePlaylistResult> {
  const jspfTracks = tracks.map((track) => ({
    identifier: [`https://www.youtube.com/watch?v=${track.videoId}`],
    title: track.title,
    ...(track.author ? { creator: track.author } : {}),
    extension: {
      "https://musicbrainz.org/doc/jspf#track": {
        additional_metadata: {
          music_service: "youtube.com",
          youtube_id: track.videoId,
        },
      },
    },
  }));

  const payload = {
    playlist: {
      title: playlistTitle,
      ...(description ? { annotation: description } : {}),
      track: jspfTracks,
      extension: {
        "https://musicbrainz.org/doc/jspf#playlist": {
          public: true,
          description: description ?? `Playlist created from Elysium — ${new Date().toLocaleDateString()}`,
          additional_metadata: {
            submission_client: "Elysium",
          },
        },
      },
    },
  };

  try {
    const res = await fetch(`${LISTENBRAINZ_API_URL}/playlist/create`, {
      method: "POST",
      headers: {
        Authorization: `Token ${credentials.userToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return {
        success: false,
        error: errData?.error ?? `HTTP ${res.status}: ${res.statusText}`,
      };
    }

    const data = await res.json();
    const mbid = data?.playlist_mbid;

    if (!mbid) {
      return { success: false, error: "No playlist MBID returned" };
    }

    return {
      success: true,
      playlistMbid: mbid,
      playlistUrl: `https://listenbrainz.org/playlist/${mbid}`,
    };
  } catch (err: any) {
    return { success: false, error: err?.message ?? "Network error" };
  }
}

// ─── Playlist Sync (Bi-directional) ───────────────────────────────────────

export interface LBPlaylist {
  identifier: string; // full URL like https://listenbrainz.org/playlist/{mbid}
  title: string;
  mbid: string;
  trackCount: number;
  creator: string;
  annotation?: string;
  tracks: LBPlaylistTrack[];
}

export interface LBPlaylistSyncResult {
  created: string[];
  skipped: string[];
  errors: string[];
  total: number;
}

/**
 * Fetch all playlists for the authenticated user from ListenBrainz.
 * Returns a list with mbid, title, creator and track stubs.
 */
export async function getListenBrainzPlaylists(
  credentials: ListenBrainzCredentials,
  offset = 0,
  count = 25,
): Promise<{ playlists: LBPlaylist[]; total: number }> {
  try {
    const res = await fetch(
      `${LISTENBRAINZ_API_URL}/user/${encodeURIComponent(credentials.username)}/playlists?offset=${offset}&count=${count}`,
      { headers: { Authorization: `Token ${credentials.userToken}` } },
    );
    if (!res.ok) return { playlists: [], total: 0 };
    const data = await res.json();

    const raw = data?.playlists ?? [];
    const playlists: LBPlaylist[] = raw.map((p: any) => {
      const pl = p?.playlist ?? p;
      const identifier = pl?.identifier ?? "";
      const mbid = identifier.split("/").pop() ?? "";
      return {
        identifier,
        title: pl?.title ?? "Untitled",
        mbid,
        creator: pl?.creator ?? credentials.username,
        annotation: pl?.annotation,
        trackCount: (pl?.track ?? []).length,
        tracks: (pl?.track ?? []).map((t: any) => ({
          videoId: t?.extension?.["https://musicbrainz.org/doc/jspf#track"]?.additional_metadata?.youtube_id
            ?? extractYoutubeId(Array.isArray(t?.identifier) ? t.identifier[0] : t?.identifier ?? ""),
          title: t?.title ?? "Unknown",
          author: t?.creator,
        })),
      };
    });

    return { playlists, total: data?.playlist_count ?? playlists.length };
  } catch {
    return { playlists: [], total: 0 };
  }
}

/** Extract a YouTube video ID from a full YouTube URL */
function extractYoutubeId(url: string): string {
  if (!url) return "";
  const match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (match) return match[1];
  // youtu.be short URLs
  const short = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (short) return short[1];
  return "";
}

/**
 * Fetch a single playlist by MBID from ListenBrainz (includes full track list).
 */
export async function getListenBrainzPlaylistById(
  credentials: ListenBrainzCredentials,
  mbid: string,
): Promise<LBPlaylist | null> {
  try {
    const res = await fetch(
      `${LISTENBRAINZ_API_URL}/playlist/${mbid}`,
      { headers: { Authorization: `Token ${credentials.userToken}` } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const pl = data?.playlist ?? data;
    const identifier = pl?.identifier ?? `https://listenbrainz.org/playlist/${mbid}`;

    return {
      identifier,
      title: pl?.title ?? "Untitled",
      mbid,
      creator: pl?.creator ?? credentials.username,
      annotation: pl?.annotation,
      trackCount: (pl?.track ?? []).length,
      tracks: (pl?.track ?? []).map((t: any) => ({
        videoId: t?.extension?.["https://musicbrainz.org/doc/jspf#track"]?.additional_metadata?.youtube_id
          ?? extractYoutubeId(Array.isArray(t?.identifier) ? t.identifier[0] : t?.identifier ?? ""),
        title: t?.title ?? "Unknown",
        author: t?.creator,
      })),
    };
  } catch {
    return null;
  }
}

/**
 * Sync all local playlists to ListenBrainz in one batch.
 * Creates a LB playlist for each local playlist.
 * Returns a result summary.
 */
export async function syncAllPlaylistsToListenBrainz(
  credentials: ListenBrainzCredentials,
  playlists: Array<{ title: string; tracks: LBPlaylistTrack[]; description?: string }>,
  onProgress?: (done: number, total: number, current: string) => void,
): Promise<LBPlaylistSyncResult> {
  const result: LBPlaylistSyncResult = { created: [], skipped: [], errors: [], total: playlists.length };

  for (let i = 0; i < playlists.length; i++) {
    const pl = playlists[i];
    onProgress?.(i, playlists.length, pl.title);

    if (!pl.tracks.length) {
      result.skipped.push(pl.title);
      continue;
    }

    try {
      const res = await createListenBrainzPlaylist(credentials, pl.title, pl.tracks, pl.description);
      if (res.success && res.playlistUrl) {
        result.created.push(pl.title);
      } else {
        result.errors.push(`${pl.title}: ${res.error ?? "Unknown error"}`);
      }
    } catch (e: any) {
      result.errors.push(`${pl.title}: ${e?.message ?? "Network error"}`);
    }

    // Polite rate limiting — 300ms between requests
    if (i < playlists.length - 1) {
      await new Promise<void>((r) => setTimeout(r, 300));
    }
  }

  onProgress?.(playlists.length, playlists.length, "");
  return result;
}

/**
 * Delete a ListenBrainz playlist by MBID.
 */
export async function deleteListenBrainzPlaylist(
  credentials: ListenBrainzCredentials,
  mbid: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${LISTENBRAINZ_API_URL}/playlist/${mbid}/delete`, {
      method: "POST",
      headers: {
        Authorization: `Token ${credentials.userToken}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { success: false, error: data?.error ?? `HTTP ${res.status}` };
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message ?? "Network error" };
  }
}

// ─── YouTube Resolution ────────────────────────────────────────────────────────

/**
 * Resolve an "artist - track" query to a YouTube videoId using the
 * configured Invidious instance. Returns null if nothing is found.
 *
 * This is the same strategy used by listenbrainz-charts.ts for charts/recommendations.
 */
export async function resolveTrackToYouTube(
  invidiousBaseUri: string,
  artistName: string,
  trackName: string,
): Promise<{ videoId: string; title: string; thumbnail: string } | null> {
  if (!invidiousBaseUri || !artistName || !trackName) return null;
  const query = `${artistName} - ${trackName}`;
  try {
    const url = `${invidiousBaseUri}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance&page=1`;
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
      thumbnail: video.videoThumbnails?.[0]?.url ?? `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`,
    };
  } catch {
    return null;
  }
}

/**
 * Extended track type that includes resolved YouTube data alongside LB metadata.
 * Used for enriched playlist display.
 */
export interface LBEnrichedTrack {
  /** Original LB track data */
  lbTrack: LBPlaylistTrack;
  /** Resolved YouTube video ID (from LB extension or Invidious search) */
  videoId: string | null;
  /** Display title */
  title: string;
  /** Artist / creator name */
  artist: string;
  /** YouTube thumbnail URL */
  thumbnail: string | null;
  /** Whether this was resolved via Invidious search (vs stored YouTube ID) */
  resolvedViaSearch: boolean;
}

/**
 * Enrich a list of LBPlaylistTracks by resolving any without a YouTube ID
 * via Invidious search. Returns enriched tracks with YouTube data attached.
 *
 * Tracks that already have a videoId are passed through immediately.
 * Tracks without a videoId are resolved via "artist - title" Invidious search.
 */
export async function enrichLBPlaylistTracks(
  tracks: LBPlaylistTrack[],
  invidiousBaseUri: string,
  concurrency = 4,
): Promise<LBEnrichedTrack[]> {
  const results: LBEnrichedTrack[] = new Array(tracks.length);

  // Split into already-resolved and needs-search
  const needsSearch: Array<{ index: number; track: LBPlaylistTrack }> = [];

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (t.videoId) {
      results[i] = {
        lbTrack: t,
        videoId: t.videoId,
        title: t.title,
        artist: t.author ?? "",
        thumbnail: `https://i.ytimg.com/vi/${t.videoId}/mqdefault.jpg`,
        resolvedViaSearch: false,
      };
    } else {
      needsSearch.push({ index: i, track: t });
    }
  }

  // Resolve via Invidious in batches
  for (let i = 0; i < needsSearch.length; i += concurrency) {
    const batch = needsSearch.slice(i, i + concurrency);
    const resolved = await Promise.all(
      batch.map(({ track }) =>
        resolveTrackToYouTube(invidiousBaseUri, track.author ?? track.title, track.title),
      ),
    );
    batch.forEach(({ index, track }, j) => {
      const yt = resolved[j];
      results[index] = {
        lbTrack: track,
        videoId: yt?.videoId ?? null,
        title: yt?.title ?? track.title,
        artist: track.author ?? "",
        thumbnail: yt?.thumbnail ?? null,
        resolvedViaSearch: !!yt,
      };
    });
  }

  return results;
}

// ─── Add Tracks to Existing LB Playlist ──────────────────────────────────────

/**
 * Build a JSPF track object from an Elysium video (YouTube-based).
 * Follows the ListenBrainz JSPF extension spec:
 * https://listenbrainz.readthedocs.io/en/latest/users/api/playlist.html
 */
export function buildJspfTrack(
  videoId: string,
  title: string,
  artist?: string,
  recordingMbid?: string,
): Record<string, unknown> {
  return {
    identifier: [`https://www.youtube.com/watch?v=${videoId}`],
    title,
    ...(artist ? { creator: artist } : {}),
    ...(recordingMbid
      ? { id: `https://musicbrainz.org/recording/${recordingMbid}` }
      : {}),
    extension: {
      "https://musicbrainz.org/doc/jspf#track": {
        additional_metadata: {
          music_service: "youtube.com",
          music_service_name: "YouTube",
          youtube_id: videoId,
          submission_client: "Elysium",
        },
      },
    },
  };
}

export interface LBAddTracksResult {
  success: boolean;
  error?: string;
}

/**
 * Add tracks to an existing ListenBrainz playlist at the given offset.
 * Uses POST /1/playlist/{playlist_mbid}/item/add/{offset}
 * Docs: https://listenbrainz.readthedocs.io/en/latest/users/api/playlist.html
 *
 * Pass offset = 0 to prepend, offset = -1 or omit to append at end.
 * LB API: offset defaults to appending at the end if omitted.
 */
export async function addTracksToListenBrainzPlaylist(
  credentials: ListenBrainzCredentials,
  playlistMbid: string,
  tracks: LBPlaylistTrack[],
  offset?: number,
): Promise<LBAddTracksResult> {
  if (!tracks.length) return { success: true };

  const jspfTracks = tracks.map((t) =>
    buildJspfTrack(t.videoId, t.title, t.author),
  );

  const url =
    offset != null && offset >= 0
      ? `${LISTENBRAINZ_API_URL}/playlist/${playlistMbid}/item/add/${offset}`
      : `${LISTENBRAINZ_API_URL}/playlist/${playlistMbid}/item/add`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Token ${credentials.userToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ playlist: { track: jspfTracks } }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return {
        success: false,
        error: errData?.error ?? `HTTP ${res.status}: ${res.statusText}`,
      };
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message ?? "Network error" };
  }
}

/**
 * Convert a Elysium CardVideo/Video into an LBPlaylistTrack ready for
 * submission to ListenBrainz. Parses artist/title from the video title
 * using the same heuristic as the scrobbling service.
 */
export function videoToLBTrack(video: {
  videoId: string;
  title: string;
  author?: string;
}): LBPlaylistTrack {
  const { artist, track } = parseArtistTrack(video.title, video.author ?? "");
  return {
    videoId: video.videoId,
    title: track,
    author: artist,
  };
}
