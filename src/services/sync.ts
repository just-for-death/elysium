/**
 * Multi-device sync service
 *
 * All sync data travels through /api/sync/* on the Elysium server so there
 * are no CORS / HTTPS-upgrade issues (same-origin, no external call from
 * the browser).
 *
 * Payload includes: playlists, favorites, history, followed artists.
 * The server stores it in-memory keyed by a short code (TTL = 24 h).
 * Any device can push (gets a fresh code) or pull by code.
 */

import { db } from "../database";
import {
  getAllPlaylists,
  getFavoritePlaylist,
  getPlaylists,
  getVideosHistory,
  importPlaylist,
  importVideosToFavorites,
  updatePlaylistVideos,
} from "../database/utils";
import {
  getFollowedArtists,
  addFollowedArtist,
  type FollowedArtist,
} from "../providers/FollowedArtists";
import type { CardVideo, CardPlaylist } from "../types/interfaces/Card";
import type { FavoritePlaylist, Playlist } from "../types/interfaces/Playlist";
import { log } from "../utils/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SyncPayload {
  version: 2;
  pushedAt: string; // ISO timestamp
  playlists: CardPlaylist[];
  history: CardVideo[];
  followedArtists: FollowedArtist[];
}

export interface PushResult {
  ok: boolean;
  code?: string; // 6-digit code shown to user
  error?: string;
}

export interface PullResult {
  ok: boolean;
  summary?: {
    newFavorites: number;
    newPlaylists: number;
    updatedPlaylists: number;
    newHistory: number;
    newArtists: number;
  };
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const buildPayload = (): SyncPayload => ({
  version: 2,
  pushedAt: new Date().toISOString(),
  playlists: getAllPlaylists(),
  history: getVideosHistory().slice(0, 500), // cap at 500 to keep payload small
  followedArtists: getFollowedArtists(),
});

// ─── Push ─────────────────────────────────────────────────────────────────────

/**
 * Serialise local data and send to the server.
 * Returns the 6-digit code that other devices can use to pull.
 */
export const pushSync = async (): Promise<PushResult> => {
  try {
    const payload = buildPayload();
    const res = await fetch("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Server error ${res.status}: ${body}` };
    }
    const json = await res.json();
    return { ok: true, code: json.code };
  } catch (err) {
    log.warn("[sync] push failed", { err });
    return { ok: false, error: String(err) };
  }
};

// ─── Pull ─────────────────────────────────────────────────────────────────────

/**
 * Fetch remote data by code and merge it into the local database.
 * Uses a non-destructive merge: remote data is added/updated, nothing is deleted.
 */
export const pullSync = async (
  code: string,
  setters: {
    setFavorite: (p: FavoritePlaylist) => void;
    setPlaylists: (p: Playlist[]) => void;
    setHistory?: () => void;
    setFollowedArtists?: () => void;
  },
): Promise<PullResult> => {
  try {
    const res = await fetch(`/api/sync/pull/${encodeURIComponent(code.trim())}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      if (res.status === 404) return { ok: false, error: "Code not found or expired" };
      return { ok: false, error: `Server error ${res.status}` };
    }
    const remote: SyncPayload = await res.json();
    return mergeRemote(remote, setters);
  } catch (err) {
    log.warn("[sync] pull failed", { err });
    return { ok: false, error: String(err) };
  }
};

// ─── Merge ────────────────────────────────────────────────────────────────────

const mergeRemote = (
  remote: SyncPayload,
  setters: {
    setFavorite: (p: FavoritePlaylist) => void;
    setPlaylists: (p: Playlist[]) => void;
    setHistory?: () => void;
    setFollowedArtists?: () => void;
  },
): PullResult => {
  let newFavorites = 0;
  let newPlaylists = 0;
  let updatedPlaylists = 0;
  let newHistory = 0;
  let newArtists = 0;

  try {
    // ── Favorites ──────────────────────────────────────────────────────────
    const remoteFavorites = remote.playlists?.find((p: any) => p.title === "Favorites") as unknown as FavoritePlaylist | undefined;
    if (remoteFavorites?.cards?.length) {
      const localFav = getFavoritePlaylist();
      const localIds = new Set((localFav.cards ?? []).map((c: any) => c.videoId ?? c.ID));
      const incoming = remoteFavorites.cards.filter((c: any) => !localIds.has(c.videoId ?? c.ID));
      if (incoming.length > 0) {
        importVideosToFavorites(incoming as any);
        setters.setFavorite(getFavoritePlaylist());
        newFavorites = incoming.length;
      }
    }

    // ── Regular playlists ──────────────────────────────────────────────────
    // Use any[] to avoid the Playlist vs CardPlaylist type incompatibility —
    // both shapes have title + videos at runtime which is all we need here.
    const localPlaylists: any[] = (getAllPlaylists() as any[]).filter(
      (p) => p.title !== "Favorites" && p.title !== "Cache"
    );
    const remotePlaylists: any[] = (remote.playlists ?? []).filter(
      (p: any) => p.title !== "Favorites" && p.title !== "Cache"
    );
    const localTitles = new Set(localPlaylists.map((p) => p.title));

    for (const pl of remotePlaylists) {
      // 1. Match by syncId first — survives renames, prevents duplicates
      if (pl.syncId) {
        const byId = localPlaylists.find((p) => p.syncId === pl.syncId);
        if (byId) {
          const localVideos = byId.videos ?? [];
          const localVideoIds = new Set(localVideos.map((v: any) => v.videoId));
          const newVideos = (pl.videos ?? []).filter((v: any) => !localVideoIds.has(v.videoId));
          const merged = [...localVideos, ...newVideos];
          const videosActuallyChanged = merged.length !== localVideos.length ||
            merged.some((v: any, i: number) => v.videoId !== (localVideos as any[])[i]?.videoId);
          if (videosActuallyChanged) {
            updatePlaylistVideos(byId.title, merged as CardVideo[]);
            updatedPlaylists++;
          }
          continue;
        }
      }
      // 2. Fall back to title match (legacy playlists without syncId yet)
      if (!localTitles.has(pl.title)) {
        // Brand-new playlist on remote — import it, carrying all identity fields
        importPlaylist({ ...pl, type: "playlist", videoCount: pl.videos?.length ?? 0 });
        newPlaylists++;
      } else {
        // Playlist exists locally — add new videos (additive only)
        const local = localPlaylists.find((p) => p.title === pl.title);
        const localVideos = local?.videos ?? [];
        const localVideoIds = new Set(localVideos.map((v: any) => v.videoId));
        const newVideos = (pl.videos ?? []).filter((v: any) => !localVideoIds.has(v.videoId));
        const merged = [...localVideos, ...newVideos];
        const videosActuallyChanged = merged.length !== localVideos.length ||
          merged.some((v: any, i: number) => v.videoId !== (localVideos as any[])[i]?.videoId);
        if (videosActuallyChanged) {
          updatePlaylistVideos(pl.title, merged as CardVideo[]);
          updatedPlaylists++;
        }
      }
    }
    if (newPlaylists > 0 || updatedPlaylists > 0) {
      setters.setPlaylists(getPlaylists());
    }

    // ── History ────────────────────────────────────────────────────────────
    if (remote.history?.length) {
      const localHistory = getVideosHistory();
      const localIds = new Set(localHistory.map((v) => v.videoId));
      const newItems = remote.history.filter((v) => !localIds.has(v.videoId));
      for (const item of newItems) {
        try {
          db.insert("history", item);
          newHistory++;
        } catch {
          // skip duplicates
        }
      }
      if (newItems.length > 0) {
        db.commit();
        setters.setHistory?.();
      }
    }

    // ── Followed artists ───────────────────────────────────────────────────
    if (remote.followedArtists?.length) {
      const localIds = new Set(getFollowedArtists().map((a) => a.artistId));
      for (const artist of remote.followedArtists) {
        if (!localIds.has(artist.artistId)) {
          addFollowedArtist(artist);
          newArtists++;
        }
      }
      if (newArtists > 0) setters.setFollowedArtists?.();
    }

    return {
      ok: true,
      summary: { newFavorites, newPlaylists, updatedPlaylists, newHistory, newArtists },
    };
  } catch (err) {
    log.warn("[sync] merge failed", { err });
    return { ok: false, error: `Merge error: ${String(err)}` };
  }
};

// ─── Persist last-sync timestamp ──────────────────────────────────────────────

export const saveLastSyncAt = (iso: string) => {
  try {
    db.update("settings", { ID: 1 }, () => ({ lastSyncAt: iso }));
    db.commit();
  } catch {
    // non-fatal
  }
};
