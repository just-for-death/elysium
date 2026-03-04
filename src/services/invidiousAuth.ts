/**
 * Invidious Account Auth + Playlist Sync
 *
 * All Invidious API calls go through dedicated server-side endpoints.
 * The server uses "Cookie: SID=<value>" directly — no token format guessing,
 * no general proxy, no Authorization: Bearer complications.
 *
 * Server endpoints:
 *   POST   /api/invidious/login                        – form login → SID
 *   GET    /api/invidious/playlists                    – list playlists
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
  videoId: string,
): Promise<void> {
  await fetch(`/api/invidious/playlists/${playlistId}/videos/${videoId}`, {
    method: "DELETE", headers: authHeaders(creds),
  });
}

export async function deleteInvidiousPlaylist(creds: InvidiousCredentials, playlistId: string): Promise<void> {
  await fetch(`/api/invidious/playlists/${playlistId}`, {
    method: "DELETE", headers: authHeaders(creds),
  });
}

export async function pushPlaylistToInvidious(
  creds: InvidiousCredentials,
  title: string,
  videos: CardVideo[],
  privacy: "public" | "private" | "unlisted" = "private",
): Promise<string> {
  const playlistId = await createInvidiousPlaylist(creds, title, privacy);
  if (!playlistId) throw new Error("Failed to create playlist — no ID returned");
  for (const v of videos) {
    try { await addVideoToInvidiousPlaylist(creds, playlistId, v.videoId); }
    catch { /* skip — partial sync is fine */ }
  }
  return playlistId;
}
