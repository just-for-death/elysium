// ListenBrainz Scrobbling Service
// Uses ListenBrainz API v1 with User Token authentication
// Docs: https://listenbrainz.readthedocs.io/en/latest/users/api/core.html
// JSON format: https://listenbrainz.readthedocs.io/en/latest/users/json.html

import { extractArtistTrack } from "./lyrics";

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

export interface LBTopArtist {
  artist_name: string;
  listen_count: number;
  artist_mbid?: string;
}

/** Fetch the user's top artists for a given time range */
export async function getTopArtists(
  credentials: ListenBrainzCredentials,
  range: "week" | "month" | "year" | "all_time" = "month",
  count = 10,
): Promise<LBTopArtist[]> {
  try {
    const res = await fetch(
      `${LISTENBRAINZ_API_URL}/stats/user/${encodeURIComponent(credentials.username)}/artists?count=${count}&range=${range}`,
      { headers: { Authorization: `Token ${credentials.userToken}` } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data?.payload?.artists ?? [];
  } catch {
    return [];
  }
}

// ─── MusicBrainz Recording Lookup ────────────────────────────────────────────

/**
 * Strip common YouTube title noise so lookups match better.
 * e.g. "Never Gonna Give You Up (Official Video)" → "Never Gonna Give You Up"
 */
function cleanTitle(raw: string): string {
  return raw
    .replace(/\s*[\(\[【][^\)\]】]*(?:official|video|audio|lyric|lyrics|mv|hd|4k|music video|visualizer|feat\.|ft\.)[^\)\]】]*[\)\]】]/gi, "")
    .replace(/\s*[\(\[【][^\)\]】]{0,40}[\)\]】]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Strip YouTube channel suffixes from an artist/author name.
 * e.g. "BTS - Topic" → "BTS", "TaylorSwiftVEVO" → "TaylorSwift"
 */
function cleanArtist(raw: string): string {
  return raw
    .replace(/\s*-\s*Topic\s*$/i, "")
    .replace(/\s*VEVO\s*$/i, "")
    .replace(/\s*Official\s*$/i, "")
    .replace(/\s*-\s*Official\s*$/i, "")
    .trim();
}

/**
 * Look up a MusicBrainz recording MBID by artist + title.
 *
 * Strategy (in order):
 *  1. If artist is provided: LB metadata lookup directly (requires auth token).
 *  2. If artist is missing: title likely encodes "Track — Artist" (LB Home format)
 *     or "Artist - Track" (YouTube format). Try both orderings via LB lookup.
 *  3. MusicBrainz search fallback with whatever we have.
 *
 * Returns null if nothing matches.
 */
async function lookupRecordingMbid(artist: string, title: string, userToken: string): Promise<string | null> {
  if (!artist && !title) return null;

  const lbLookup = async (artistName: string, recordingName: string): Promise<string | null> => {
    if (!artistName || !recordingName) return null;
    try {
      const params = new URLSearchParams({
        // Clean both sides — artist may carry "(Official Video)" noise too
        artist_name: cleanArtist(cleanTitle(artistName)),
        recording_name: cleanTitle(recordingName),
        metadata: "false",
      });
      // Use trailing slash — without it LB returns a 308 redirect which browsers
      // refuse to follow cross-origin (CORS headers missing on redirect).
      const res = await fetch(`${LISTENBRAINZ_API_URL}/metadata/lookup/?${params.toString()}`, {
        headers: {
          "Accept": "application/json",
          "Authorization": `Token ${userToken}`,
        },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return (data?.recording_mbid as string | undefined) ?? null;
    } catch {
      return null;
    }
  };

  // ── Case 1: artist is known — straightforward LB lookup ──────────────────
  if (artist) {
    const mbid = await lbLookup(artist, title);
    if (mbid) return mbid;
  } else {
    // ── Case 2: no artist — pre-clean the full title, then parse and try both orderings
    // LB-generated playlists: "Track — Artist"  |  Bollywood: "Track: Artist | more"
    // YouTube: "Artist - Track (Official Video)" etc.
    const titleCleaned = cleanTitle(title);

    // Colon pattern: "Track: Artist | ..." — only when afterColon has " | " (Bollywood/Indian)
    // Guard prevents "Spider-Man: No Way Home" → track="Spider-Man" false positive
    const colonIdx = titleCleaned.indexOf(": ");
    if (colonIdx > 0) {
      const afterColon = titleCleaned.slice(colonIdx + 2);
      const pipeIdx    = afterColon.indexOf(" | ");
      if (pipeIdx > 0) {
        const trackPart  = titleCleaned.slice(0, colonIdx).trim();
        const artistPart = afterColon.slice(0, pipeIdx).trim();
        if (trackPart && artistPart) {
          const mbid = await lbLookup(artistPart, trackPart);
          if (mbid) return mbid;
        }
      }
    }

    // Dash/pipe separators — try both orderings
    const separators = [" — ", " – ", " - ", " | "];
    for (const sep of separators) {
      const idx = titleCleaned.indexOf(sep);
      if (idx > 0) {
        const left  = titleCleaned.slice(0, idx).trim();
        const right = titleCleaned.slice(idx + sep.length).trim();
        // Try "Track — Artist" (LB Home format) first
        const mbid1 = await lbLookup(right, left);
        if (mbid1) return mbid1;
        // Try "Artist - Track" (YouTube format) second
        const mbid2 = await lbLookup(left, right);
        if (mbid2) return mbid2;
        break;
      }
    }
  }

  // ── Fallback: MusicBrainz search with raw title ───────────────────────────
  try {
    const escape = (s: string) => s.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&");
    const cleaned = cleanTitle(title);
    const q = cleaned && artist
      ? `recording:"${escape(cleaned)}" artist:"${escape(artist)}"`
      : `recording:"${escape(cleaned || title)}"`;
    const res = await fetch(
      `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(q)}&limit=1&fmt=json`,
      { headers: { "User-Agent": "Elysium/1.12 (https://github.com/ssnarf/Elysium)", "Accept": "application/json" } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.recordings?.[0]?.id as string | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve recording MBIDs for a list of tracks.
 * Tracks that already have a MBID are passed through. Others are looked up
 * via the ListenBrainz metadata lookup API (with MusicBrainz as fallback).
 */
async function resolveTrackMbids(
  tracks: LBPlaylistTrack[],
  userToken: string,
  onProgress?: (done: number, total: number) => void,
): Promise<Array<LBPlaylistTrack & { recordingMbid: string | undefined }>> {
  const results: Array<LBPlaylistTrack & { recordingMbid: string | undefined }> = [];

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (t.recordingMbid) {
      results.push({ ...t, recordingMbid: t.recordingMbid });
    } else {
      const mbid = await lookupRecordingMbid(t.author ?? "", t.title, userToken);
      results.push({ ...t, recordingMbid: mbid ?? undefined });
    }
    onProgress?.(i + 1, tracks.length);
  }
  return results;
}

// ─── Playlist Creation ─────────────────────────────────────────────────────

export interface LBPlaylistTrack {
  videoId: string;
  title: string;
  author?: string;
  /** MusicBrainz recording MBID — required by the LB API as the JSPF track identifier */
  recordingMbid?: string;
}

export interface LBCreatePlaylistResult {
  success: boolean;
  playlistMbid?: string;
  playlistUrl?: string;
  error?: string;
}

/**
 * Create a ListenBrainz playlist from a list of tracks.
 * Uses JSPF format. The LB API requires each track's `identifier` to be a
 * fully-qualified MusicBrainz recording URI
 * (e.g. https://musicbrainz.org/recording/{mbid}).
 * Tracks without a stored MBID are looked up via MusicBrainz search first.
 * Tracks that cannot be resolved are skipped with a warning.
 */
export async function createListenBrainzPlaylist(
  credentials: ListenBrainzCredentials,
  playlistTitle: string,
  tracks: LBPlaylistTrack[],
  description?: string,
  onProgress?: (done: number, total: number) => void,
): Promise<LBCreatePlaylistResult> {
  // 1. Resolve recording MBIDs — LB requires them as the track identifier
  const resolved = await resolveTrackMbids(tracks, credentials.userToken, onProgress);

  // 2. Build JSPF tracks — skip any that could not be resolved to a MBID
  const jspfTracks = resolved
    .filter((t) => !!t.recordingMbid)
    .map((track) => ({
      identifier: [`https://musicbrainz.org/recording/${track.recordingMbid}`],
      title: track.title,
      ...(track.author ? { creator: track.author } : {}),
      extension: {
        "https://musicbrainz.org/doc/jspf#track": {
          additional_metadata: {
            music_service: "youtube.com",
            music_service_name: "YouTube",
            ...(track.videoId ? { youtube_id: track.videoId, origin_url: `https://www.youtube.com/watch?v=${track.videoId}` } : {}),
            submission_client: SUBMISSION_CLIENT,
          },
        },
      },
    }));

  if (!jspfTracks.length) {
    return {
      success: false,
      error: "No tracks could be resolved to MusicBrainz recordings. Ensure track titles include the artist name (e.g. \"Artist - Title\").",
    };
  }

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
  /** null means unknown — the list API never returns track counts */
  trackCount: number | null;
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
        // The LB list API intentionally returns playlists WITHOUT recordings.
        // Track count is not available in the list response — set to null until fetched by ID.
        trackCount: null,
        tracks: [],
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
      tracks: (pl?.track ?? []).map((t: any) => {
        // The JSPF identifier[0] is the recording MBID URI:
        //   https://musicbrainz.org/recording/{mbid}
        // The YouTube ID lives in the extension's additional_metadata.
        const rawIdentifier: string = Array.isArray(t?.identifier) ? t.identifier[0] : (t?.identifier ?? "");
        const mbidMatch = rawIdentifier.match(/musicbrainz\.org\/recording\/([0-9a-f-]{36})/i);
        const recordingMbid = mbidMatch?.[1] ?? undefined;
        const youtubeId =
          t?.extension?.["https://musicbrainz.org/doc/jspf#track"]?.additional_metadata?.youtube_id
          ?? extractYoutubeId(rawIdentifier);
        return {
          videoId: youtubeId,
          title: t?.title ?? "Unknown",
          author: t?.creator,
          ...(recordingMbid ? { recordingMbid } : {}),
        };
      }),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch ALL user playlists from ListenBrainz (paginated).
 * Returns a flat list of all LBPlaylist metadata (no track content).
 */
async function fetchAllUserPlaylists(
  credentials: ListenBrainzCredentials,
): Promise<LBPlaylist[]> {
  const pageSize = 50;
  const all: LBPlaylist[] = [];
  let offset = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { playlists, total } = await getListenBrainzPlaylists(credentials, offset, pageSize);
    all.push(...playlists);
    offset += playlists.length;
    if (offset >= total || playlists.length === 0) break;
    await new Promise<void>((r) => setTimeout(r, 150));
  }
  return all;
}

/**
 * Sync all local playlists to ListenBrainz in one batch.
 *
 * For each local playlist:
 *   1. Fetch all existing LB playlists (once, cached for this run)
 *   2. If an existing playlist with the same title AND created by Elysium exists → delete it
 *   3. Create the updated playlist fresh
 *
 * This implements true "sync" rather than always-create.
 */
export async function syncAllPlaylistsToListenBrainz(
  credentials: ListenBrainzCredentials,
  playlists: Array<{ title: string; tracks: LBPlaylistTrack[]; description?: string }>,
  onProgress?: (done: number, total: number, current: string) => void,
): Promise<LBPlaylistSyncResult> {
  const result: LBPlaylistSyncResult = { created: [], skipped: [], errors: [], total: playlists.length };

  // Fetch the full playlist list once upfront so we can look up existing playlists by title
  let existingPlaylists: LBPlaylist[] = [];
  try {
    existingPlaylists = await fetchAllUserPlaylists(credentials);
  } catch {
    // Non-fatal — we'll just create without dedup
  }

  // Build a title → mbid map for playlists created by Elysium
  // We identify Elysium playlists by checking the creator field against the username
  // (we can't easily read additional_metadata from the list endpoint, so we match
  // by title and creator=username to avoid deleting playlists created by other tools)
  const existingByTitle = new Map<string, string>();
  for (const pl of existingPlaylists) {
    if (pl.title && pl.mbid && pl.creator === credentials.username) {
      // Use lowercase key to be case-insensitive
      existingByTitle.set(pl.title.toLowerCase(), pl.mbid);
    }
  }

  for (let i = 0; i < playlists.length; i++) {
    const pl = playlists[i];
    onProgress?.(i, playlists.length, pl.title);

    if (!pl.tracks.length) {
      result.skipped.push(pl.title);
      continue;
    }

    try {
      // Step 1: delete existing playlist with the same title if it exists
      const existingMbid = existingByTitle.get(pl.title.toLowerCase());
      if (existingMbid) {
        await deleteListenBrainzPlaylist(credentials, existingMbid);
        await new Promise<void>((r) => setTimeout(r, 200));
      }

      // Step 2: create the updated playlist
      const res = await createListenBrainzPlaylist(credentials, pl.title, pl.tracks, pl.description);
      if (res.success && res.playlistUrl) {
        result.created.push(pl.title);
      } else {
        result.errors.push(`${pl.title}: ${res.error ?? "Unknown error"}`);
      }
    } catch (e: any) {
      result.errors.push(`${pl.title}: ${e?.message ?? "Network error"}`);
    }

    // Polite rate limiting between playlists
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
    const params = new URLSearchParams({
      instanceUrl: invidiousBaseUri,
      q: query,
      type: "video",
      sort_by: "relevance",
      page: "1",
    });
    const url = `/api/invidious/search?${params.toString()}`;
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
 * Build a JSPF track object from an Elysium video.
 * The LB API requires `identifier` to be a MusicBrainz recording URI.
 * The YouTube URL is stored in the extension's additional_metadata instead.
 *
 * IMPORTANT: recordingMbid is required for the identifier. If not provided,
 * call lookupRecordingMbid() first before building the track.
 */
export function buildJspfTrack(
  videoId: string,
  title: string,
  artist?: string,
  recordingMbid?: string,
): Record<string, unknown> {
  return {
    // LB requires a recording MBID URI as the identifier — not a YouTube URL
    identifier: recordingMbid
      ? [`https://musicbrainz.org/recording/${recordingMbid}`]
      : [`https://musicbrainz.org/recording/`], // placeholder; LB will reject without valid MBID
    title,
    ...(artist ? { creator: artist } : {}),
    extension: {
      "https://musicbrainz.org/doc/jspf#track": {
        additional_metadata: {
          music_service: "youtube.com",
          music_service_name: "YouTube",
          youtube_id: videoId,
          origin_url: `https://www.youtube.com/watch?v=${videoId}`,
          submission_client: SUBMISSION_CLIENT,
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

  // Resolve recording MBIDs — LB requires them as the JSPF identifier
  const resolved = await resolveTrackMbids(tracks, credentials.userToken);
  const jspfTracks = resolved
    .filter((t) => !!t.recordingMbid)
    .map((t) => buildJspfTrack(t.videoId, t.title, t.author, t.recordingMbid));

  if (!jspfTracks.length) {
    return {
      success: false,
      error: "No tracks could be resolved to MusicBrainz recordings.",
    };
  }

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
  const { artist, track } = extractArtistTrack(video.title, video.author ?? "");
  return {
    videoId: video.videoId,
    title: track,
    author: artist,
  };
}
