/**
 * Invidious Account Auth + Playlist Sync (Bidirectional)
 *
 * All Invidious API calls go through dedicated server-side endpoints.
 * The server uses "Cookie: SID=<value>" directly — no token format guessing,
 * no general proxy, no Authorization: Bearer complications.
 *
 * Sync Strategy:
 * - pushPlaylistToInvidious: CREATE a new playlist on Invidious
 * - syncPlaylistToInvidious: Add missing videos to existing remote playlist (returns false if playlist gone)
 * - pullPlaylistsFromInvidious: Import/update remote playlists into local DB
 *
 * Server endpoints:
 *   POST   /api/invidious/login                        – form login → SID
 *   GET    /api/invidious/playlists                    – list playlists
 *   GET    /api/invidious/playlists/:id                – fetch single playlist with videos
 *   POST   /api/invidious/playlists                    – create playlist
 *   POST   /api/invidious/playlists/:id/videos         – add video
 *   DELETE /api/invidious/playlists/:id/videos/:vid    – remove video
 *   DELETE /api/invidious/playlists/:id                – delete playlist
 */

import { normalizeInstanceUri } from "../utils/invidiousInstance";
import type { CardVideo } from "../types/interfaces/Card";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface InvidiousCredentials {
  instanceUrl: string;
  sid: string;
  username: string;
}

export interface InvidiousPlaylist {
  playlistId: string;
  title: string;
  videoCount: number;
  videos: Array<{
    videoId: string;
    indexId: string;   // per Invidious API — required for DELETE /videos/:index
    index: number;
    title: string;
    lengthSeconds: number;
    videoThumbnails: Array<{ quality: string; url: string }>;
    author: string;
  }>;
  privacy?: "public" | "private" | "unlisted";
  description?: string;
}

export interface InvidiousLoginResult {
  success: boolean;
  sid?: string;
  username?: string;
  instanceUrl?: string;
  error?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

// Module-level mutex: prevents concurrent playlist pushes across React component
// instances (e.g. React StrictMode double-mounts). Both instances share this lock.
let _pushInProgress = false;
export function acquirePushLock(): boolean {
  if (_pushInProgress) return false;
  _pushInProgress = true;
  return true;
}
export function releasePushLock(): void { _pushInProgress = false; }

function authHeaders(creds: InvidiousCredentials): Record<string, string> {
  return {
    "X-Invidious-Instance": creds.instanceUrl,
    "X-Invidious-SID":      creds.sid,
    "Content-Type":         "application/json",
  };
}

// ─── Login / Logout ────────────────────────────────────────────────────────────

export async function loginInvidious(
  instanceUrl: string,
  username: string,
  password: string,
): Promise<InvidiousLoginResult> {
  try {
    const res = await fetch("/api/invidious/login", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ instanceUrl: normalizeInstanceUri(instanceUrl), username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, error: data?.error ?? `HTTP ${res.status}` };
    if (!data?.sid) return { success: false, error: "No session ID returned." };
    return { success: true, sid: data.sid, username: data.username ?? username, instanceUrl: data.instanceUrl };
  } catch (e: any) {
    return { success: false, error: e?.message ?? "Network error" };
  }
}

/** Best-effort logout — clears local state; Invidious sessions expire naturally. */
export async function logoutInvidious(_creds: InvidiousCredentials): Promise<void> {
  // No server-side revocation endpoint needed — just clear the stored SID locally.
}

// ─── Playlists ─────────────────────────────────────────────────────────────────

export async function fetchInvidiousPlaylists(creds: InvidiousCredentials): Promise<InvidiousPlaylist[]> {
  const res = await fetch("/api/invidious/playlists", { method: "GET", headers: authHeaders(creds) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function fetchInvidiousPlaylist(
  creds: InvidiousCredentials,
  playlistId: string,
): Promise<InvidiousPlaylist | null> {
  // Use the single-playlist endpoint which returns the full video list.
  // The list endpoint (GET /api/v1/auth/playlists) is known to return videos:[]
  // for each playlist, making it useless for deduplication during sync.
  const res = await fetch(`/api/invidious/playlists/${playlistId}`, {
    method: "GET",
    headers: authHeaders(creds),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data ?? null;
}

/**
 * Create a new playlist on Invidious.
 * Returns the playlist ID if successful, null otherwise.
 */
export async function createInvidiousPlaylist(
  creds: InvidiousCredentials,
  title: string,
  privacy: "public" | "private" | "unlisted" = "private",
): Promise<string | null> {
  const res = await fetch("/api/invidious/playlists", {
    method:  "POST",
    headers: authHeaders(creds),
    body:    JSON.stringify({ title, privacy }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error ?? `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data?.playlistId ?? null;
}

export async function addVideoToInvidiousPlaylist(
  creds: InvidiousCredentials,
  playlistId: string,
  videoId: string,
): Promise<void> {
  const res = await fetch(`/api/invidious/playlists/${playlistId}/videos`, {
    method:  "POST",
    headers: authHeaders(creds),
    body:    JSON.stringify({ videoId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error ?? `HTTP ${res.status}`);
  }
}

export async function removeVideoFromInvidiousPlaylist(
  creds: InvidiousCredentials,
  playlistId: string,
  indexId: string,  // Invidious API requires the video's indexId, NOT the videoId
): Promise<void> {
  const res = await fetch(`/api/invidious/playlists/${playlistId}/videos/${indexId}`, {
    method: "DELETE", headers: authHeaders(creds),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error ?? `HTTP ${res.status}`);
  }
}

export async function deleteInvidiousPlaylist(creds: InvidiousCredentials, playlistId: string): Promise<void> {
  await fetch(`/api/invidious/playlists/${playlistId}`, {
    method: "DELETE", headers: authHeaders(creds),
  });
}

/**
 * Sync a local playlist to an existing Invidious playlist by ID.
 * Adds any missing videos to the remote playlist (additive only).
 * Does NOT modify playlist title/privacy.
 *
 * Returns true on success.
 * Returns false when the remote playlist no longer exists (stale mapping).
 */
export async function syncPlaylistToInvidious(
  creds: InvidiousCredentials,
  playlistId: string,
  videos: CardVideo[],
): Promise<boolean> {
  // Fetch the specific playlist by ID — NOT the full list.
  // GET /api/v1/auth/playlists returns videos:[] for every playlist (known Invidious bug).
  // GET /api/v1/auth/playlists/:id returns the actual video list.
  const remote = await fetchInvidiousPlaylist(creds, playlistId);

  // Playlist was deleted on Invidious (or never existed) — stale mapping.
  // Signal to caller so it can recreate and update the mapping.
  if (!remote) return false;

  const remoteIds = new Set((remote.videos ?? []).map((v: any) => v.videoId));

  const instanceBase = normalizeInstanceUri(creds.instanceUrl);

  for (const v of videos) {
    let realVideoId = v.videoId;

    // Resolve Apple Music virtual IDs to real YouTube video IDs
    if (realVideoId.startsWith("am:")) {
      try {
        const parsed = parseAppleMusicVideoId(realVideoId);
        if (parsed) {
          const query = `${parsed.artist} - ${parsed.title}`;
          const searchUrl = `${instanceBase}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance&page=1`;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 12000);
          try {
            const res = await fetch(searchUrl, { signal: controller.signal });
            if (res.ok) {
              const data = await res.json();
              const match = Array.isArray(data)
                ? data.find((r: any) => r.type === "video" && r.videoId && r.lengthSeconds > 0 && !r.liveNow)
                : null;
              if (match) realVideoId = match.videoId;
              else continue;
            } else {
              continue;
            }
          } finally {
            clearTimeout(timer);
          }
        }
      } catch {
        continue;
      }
    }

    // Skip videos already in the remote playlist
    if (remoteIds.has(realVideoId)) continue;

    try {
      await addVideoToInvidiousPlaylist(creds, playlistId, realVideoId);
    } catch {
      // skip failed individual videos — partial sync is fine
    }
  }
  return true;
}

/**
 * Push a local playlist to Invidious — always creates a new playlist.
 * Returns the new playlist ID.
 */
export async function pushPlaylistToInvidious(
  creds: InvidiousCredentials,
  title: string,
  videos: CardVideo[],
  privacy: "public" | "private" | "unlisted" = "private",
): Promise<string> {
  const newId = await createInvidiousPlaylist(creds, title, privacy);
  if (!newId) throw new Error("Failed to create playlist — no ID returned");
  const playlistId = newId;

  const instanceBase = normalizeInstanceUri(creds.instanceUrl);

  for (const v of videos) {
    let realVideoId = v.videoId;

    // Resolve Apple Music virtual IDs to real YouTube video IDs
    if (realVideoId.startsWith("am:")) {
      try {
        const parsed = parseAppleMusicVideoId(realVideoId);
        if (parsed) {
          const query = `${parsed.artist} - ${parsed.title}`;
          const searchUrl = `${instanceBase}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance&page=1`;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 12000);
          try {
            const res = await fetch(searchUrl, { signal: controller.signal });
            if (res.ok) {
              const data = await res.json();
              const match = Array.isArray(data)
                ? data.find((r: any) => r.type === "video" && r.videoId && r.lengthSeconds > 0 && !r.liveNow)
                : null;
              if (match) realVideoId = match.videoId;
              else continue; // can't resolve — skip this track
            } else {
              continue; // skip unresolvable
            }
          } finally {
            clearTimeout(timer);
          }
        }
      } catch {
        continue; // skip on error — partial sync is fine
      }
    }

    try {
      await addVideoToInvidiousPlaylist(creds, playlistId, realVideoId);
    } catch {
      // skip failed individual videos — partial sync is fine
    }
  }

  return playlistId;
}

function parseAppleMusicVideoId(videoId: string): { artist: string; title: string } | null {
  if (!videoId.startsWith("am:")) return null;
  const rest = videoId.slice(3); // after "am:"
  const idx1 = rest.indexOf(":");
  const idx2 = rest.indexOf(":", idx1 + 1);
  if (idx1 === -1 || idx2 === -1) return null;
  return {
    artist: decodeURIComponent(rest.slice(idx1 + 1, idx2)),
    title: decodeURIComponent(rest.slice(idx2 + 1)),
  };
}
