/**
 * usePresence — top-level hook that:
 *   1. Initialises the WebSocket connection when linked devices exist
 *   2. Broadcasts "now playing" whenever the current track changes
 *   3. Applies incoming instant sync payloads
 *   4. Applies incoming remote control commands
 *   5. Exposes linked device presence state for the sidebar widget
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { notifications } from "@mantine/notifications";

import { db }                     from "../database";
import {
  getAllPlaylists,
  getFavoritePlaylist,
  getPlaylists,
  getVideosHistory,
  importPlaylist,
  importVideosToFavorites,
  updatePlaylistVideos,
} from "../database/utils";
import { useSetFavorite }            from "../providers/Favorite";
import { useRefreshHistory }         from "../providers/History";
import { useSetFollowedArtists, getFollowedArtists, addFollowedArtist } from "../providers/FollowedArtists";
import { usePlaylists, useSetPlaylists } from "../providers/Playlist";
import { usePlayerVideo, usePlayerStatus, useSetPlayerStatus } from "../providers/Player";
import { useSettings, useSetSettings } from "../providers/Settings";
import { usePreviousNextVideos }     from "../providers/PreviousNextTrack";
import { usePlayVideo }              from "./usePlayVideo";
import { resolveDeviceName } from "../utils/deviceName";
import { presenceService } from "../services/presence";
import type { PresenceState, SyncMessage, RemoteCommand } from "../services/presence";
import { saveLastSyncAt }            from "../services/sync";
import type { FavoritePlaylist, Playlist } from "../types/interfaces/Playlist";
import type { CardVideo }            from "../types/interfaces/Card";
import type { LinkedDevice }         from "../types/interfaces/Settings";
import { log }                       from "../utils/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DevicePresence {
  code:         string;
  name:         string;
  platform:     string;
  presence:     PresenceState | null;
  online:       boolean;
  lastSeen:     string;
}

// ─── Helpers: derive permanent code (must match SyncSettings) ─────────────────

export const deriveDeviceCode = (deviceId: string): string => {
  let hash = 0;
  for (let i = 0; i < deviceId.length; i++) {
    hash = ((hash << 5) - hash + deviceId.charCodeAt(i)) | 0;
  }
  const hex = Math.abs(hash).toString(16).toUpperCase().padStart(8, "0");
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
};

// ─── Merge helper (mirror of sync.ts mergeRemote) ────────────────────────────

const mergePayload = (
  remote: any,
  setters: {
    setFavorite: (p: FavoritePlaylist) => void;
    setPlaylists: (p: Playlist[])      => void;
    setHistory:   ()                   => void;
    setFollowedArtists: ()             => void;
  }
) => {
  let newFavorites = 0, newPlaylists = 0, updatedPlaylists = 0, newHistory = 0, newArtists = 0;

  try {
    // Favorites
    const remoteFav = remote.playlists?.find((p: any) => p.title === "Favorites");
    if (remoteFav?.cards?.length) {
      const localFav  = getFavoritePlaylist();
      const localIds  = new Set((localFav.cards ?? []).map((c: any) => c.videoId ?? c.ID));
      const incoming  = remoteFav.cards.filter((c: any) => !localIds.has(c.videoId ?? c.ID));
      if (incoming.length) { importVideosToFavorites(incoming as any); setters.setFavorite(getFavoritePlaylist()); newFavorites = incoming.length; }
    }
    // Playlists
    const localPls  = (getAllPlaylists() as any[]).filter(p => p.title !== "Favorites" && p.title !== "Cache");
    const remotePls = (remote.playlists ?? []).filter((p: any) => p.title !== "Favorites" && p.title !== "Cache");
    const localTitles = new Set(localPls.map((p: any) => p.title));
    for (const pl of remotePls) {
      // 1. Match by syncId first — survives renames, prevents duplicates
      if (pl.syncId) {
        const byId = localPls.find((p: any) => p.syncId === pl.syncId);
        if (byId) {
          const localVideos = byId.videos ?? [];
          const localVids = new Set(localVideos.map((v: any) => v.videoId));
          const newVids   = (pl.videos ?? []).filter((v: any) => !localVids.has(v.videoId));
          const merged    = [...localVideos, ...newVids];
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
        importPlaylist({ ...pl, type: "playlist", videoCount: pl.videos?.length ?? 0 });
        newPlaylists++;
      } else {
        const local = localPls.find((p: any) => p.title === pl.title);
        const localVideos = local?.videos ?? [];
        const localVids = new Set(localVideos.map((v: any) => v.videoId));
        const newVids   = (pl.videos ?? []).filter((v: any) => !localVids.has(v.videoId));
        const merged    = [...localVideos, ...newVids];
        const videosActuallyChanged = merged.length !== localVideos.length ||
          merged.some((v: any, i: number) => v.videoId !== (localVideos as any[])[i]?.videoId);
        if (videosActuallyChanged) {
          updatePlaylistVideos(pl.title, merged as CardVideo[]);
          updatedPlaylists++;
        }
      }
    }
    if (newPlaylists > 0 || updatedPlaylists > 0) setters.setPlaylists(getPlaylists());
    // History
    if (remote.history?.length) {
      const localIds = new Set(getVideosHistory().map((v: any) => v.videoId));
      const items    = remote.history.filter((v: any) => !localIds.has(v.videoId));
      for (const item of items) { try { db.insert("history", item); newHistory++; } catch { /**/ } }
      if (items.length) { db.commit(); setters.setHistory(); }
    }
    // Artists
    if (remote.followedArtists?.length) {
      const localIds = new Set(getFollowedArtists().map((a: any) => a.artistId));
      for (const a of remote.followedArtists) {
        if (!localIds.has(a.artistId)) { addFollowedArtist(a); newArtists++; }
      }
      if (newArtists) setters.setFollowedArtists();
    }
  } catch (err) {
    log.warn("[presence] merge error", { err });
  }

  return { newFavorites, newPlaylists, updatedPlaylists, newHistory, newArtists };
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export const usePresence = () => {
  const settings   = useSettings() as any;
  const setSettings = useSetSettings();
  const setFavorite = useSetFavorite();
  const setPlaylists = useSetPlaylists() as (p: Playlist[]) => void;
  const playlists = usePlaylists();
  const refreshHistory = useRefreshHistory();
  const setFollowedArtists = useSetFollowedArtists();
  const { video, thumbnailUrl } = usePlayerVideo();
  const playerState = usePlayerStatus();
  const setPlayerState = useSetPlayerStatus();
  const { videosIds } = usePreviousNextVideos();
  const { handlePlay } = usePlayVideo();

  // Refs so handleRemoteCommand can access latest values without stale closures
  const nextVideoIdRef  = useRef<string | null>(null);
  const prevVideoIdRef  = useRef<string | null>(null);
  const handlePlayRef   = useRef<((id: string) => void) | null>(null);

  useEffect(() => {
    nextVideoIdRef.current  = videosIds.nextVideoId;
    prevVideoIdRef.current  = videosIds.previousVideoId;
    handlePlayRef.current   = handlePlay;
  });

  const myCode = deriveDeviceCode(settings.deviceId ?? "unknown");
  const linkedDevices: LinkedDevice[] = settings.linkedDevices ?? [];
  const linkedCodes = linkedDevices.map((d) => d.code);

  // Ref kept in sync every render so handleMessage (which is only created once)
  // always reads the current linked device list without needing to be recreated.
  const linkedCodesRef = useRef<string[]>(linkedCodes);
  linkedCodesRef.current = linkedCodes;

  // Same pattern for settings — lets pair:request read current linkedDevices
  // without relying on the stale closure captured at mount.
  const settingsRef = useRef<any>(settings);
  settingsRef.current = settings;

  // ── Per-device presence state ────────────────────────────────────────────
  const [devicePresences, setDevicePresences] = useState<Record<string, DevicePresence>>(() =>
    Object.fromEntries(
      linkedDevices.map((d) => [
        d.code,
        { code: d.code, name: d.name, platform: d.platform, presence: null, online: false, lastSeen: "" },
      ])
    )
  );

  const [wsConnected, setWsConnected] = useState(false);

  const setters = useRef({
    setFavorite: (p: FavoritePlaylist) => setFavorite(p),
    setPlaylists: (p: Playlist[]) => setPlaylists(p),
    setHistory: () => refreshHistory(),
    setFollowedArtists: () => setFollowedArtists(getFollowedArtists()),
  });
  setters.current = {
    setFavorite: (p) => setFavorite(p),
    setPlaylists: (p) => setPlaylists(p),
    setHistory: () => refreshHistory(),
    setFollowedArtists: () => setFollowedArtists(getFollowedArtists()),
  };

  // ── Init WebSocket ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!settings.deviceId) return;
    presenceService.init(myCode);
    const unsub = presenceService.onMessage(handleMessage);
    return () => {
      unsub();
      // Don't destroy — keep alive across re-renders
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myCode]);

  // Ref to current player state so handleMessage can access it without stale closure
  const currentPresenceRef = useRef<PresenceState | null>(null);

  // Keep currentPresenceRef in sync with latest video/player state
  useEffect(() => {
    const paused = playerState?.paused ?? true;
    currentPresenceRef.current = video
      ? { videoId: video.videoId, title: video.title, author: video.author, thumbnailUrl: thumbnailUrl ?? "", paused }
      : null;
  });

  // ── Update presence map when linkedDevices changes ────────────────────────
  useEffect(() => {
    setDevicePresences((prev) => {
      const next = { ...prev };
      for (const d of linkedDevices) {
        if (!next[d.code]) {
          next[d.code] = { code: d.code, name: d.name, platform: d.platform, presence: null, online: false, lastSeen: "" };
        }
      }
      // Remove unlinked
      for (const code of Object.keys(next)) {
        if (!linkedDevices.find((d) => d.code === code)) delete next[code];
      }
      return next;
    });
  }, [linkedDevices]);

  // ── Message handler ───────────────────────────────────────────────────────
  const handleMessage = useCallback((msg: SyncMessage) => {
    switch (msg.type) {
      case "connected":
        setWsConnected(true);
        break;
      case "disconnected":
        setWsConnected(false);
        // Mark all devices offline
        setDevicePresences((prev) => {
          const next = { ...prev };
          for (const code of Object.keys(next)) {
            next[code] = { ...next[code], online: false };
          }
          return next;
        });
        break;

      // peer:online = another registered device just came online on the server
      case "peer:online": {
        const { fromCode, presence: peerPresence } = msg as any;
        // Only process events from devices we have actually paired with
        if (!linkedCodesRef.current.includes(fromCode)) break;
        setDevicePresences((prev) => {
          const existing = prev[fromCode] ?? { code: fromCode, name: fromCode, platform: "other", presence: null, online: false, lastSeen: "" };
          return {
            ...prev,
            [fromCode]: {
              ...existing,
              online: true,
              // Use freshly provided presence if available, else keep existing
              presence: peerPresence !== undefined ? (peerPresence ?? existing.presence) : existing.presence,
              lastSeen: new Date().toISOString(),
            },
          };
        });
        // Re-send our own current presence directly to this peer so they
        // immediately know what WE are playing after their reconnect
        presenceService.broadcastPresenceTo(currentPresenceRef.current, fromCode);
        break;
      }

      // peer:offline = device disconnected with no remaining connections
      case "peer:offline": {
        const { fromCode } = msg as any;
        // Only process events from paired devices
        if (!linkedCodesRef.current.includes(fromCode)) break;
        setDevicePresences((prev) => {
          const existing = prev[fromCode];
          if (!existing) return prev;
          return { ...prev, [fromCode]: { ...existing, online: false } };
        });
        break;
      }

      case "presence:update": {
        const { fromCode, presence, ts } = msg as any;
        // Drop presence updates from devices we haven't paired with
        if (!linkedCodesRef.current.includes(fromCode)) break;
        setDevicePresences((prev) => {
          const existing = prev[fromCode] ?? { code: fromCode, name: fromCode, platform: "other", presence: null, online: false, lastSeen: "" };
          // presence=null is a heartbeat — device is online but not playing, keep online=true
          const isOnline = presence !== null && presence !== undefined ? true : existing.online;
          return { ...prev, [fromCode]: { ...existing, presence: presence ?? existing.presence, online: isOnline, lastSeen: ts ?? new Date().toISOString() } };
        });
        break;
      }

      case "sync:data": {
        const { fromCode, payload } = msg as any;
        // Drop sync data from devices we haven't paired with
        if (!linkedCodesRef.current.includes(fromCode)) break;
        log.debug("[presence] instant sync received", { from: fromCode });
        // Mark the sender as online since they just pushed data
        setDevicePresences((prev) => {
          const existing = prev[fromCode] ?? { code: fromCode, name: fromCode, platform: "other", presence: null, online: false, lastSeen: "" };
          return { ...prev, [fromCode]: { ...existing, online: true, lastSeen: new Date().toISOString() } };
        });
        const summary = mergePayload(payload, setters.current);
        const total = summary.newFavorites + summary.newPlaylists + summary.updatedPlaylists + summary.newHistory + summary.newArtists;
        const now = new Date().toISOString();
        saveLastSyncAt(now);
        setSettings((prev: any) => ({ ...prev, lastSyncAt: now }));
        if (total > 0) {
          const playlistMsg = (summary.newPlaylists + summary.updatedPlaylists) > 0
            ? `+${summary.newPlaylists + summary.updatedPlaylists} playlists · `
            : "";
          notifications.show({
            title: "Sync received",
            message: `+${summary.newFavorites} favourites · ${playlistMsg}+${summary.newHistory} history`,
            color: "teal",
            autoClose: 4000,
          });
        } else {
          notifications.show({ title: "Sync received", message: "Already up to date", color: "gray", autoClose: 2000 });
        }
        break;
      }

      case "remote:control": {
        const { command } = msg as any;
        log.debug("[presence] remote control received", { command });
        handleRemoteCommand(command);
        break;
      }

      // A paired device deleted a video from a playlist — apply it locally
      case "playlist:video:delete": {
        const { fromCode, playlistSyncId, playlistTitle, videoId } = msg as any;
        if (!linkedCodesRef.current.includes(fromCode)) break;
        // Find playlist by syncId first, then title fallback for legacy playlists
        const allPls = (getAllPlaylists() as any[]).filter(p => p.title !== "Favorites" && p.title !== "Cache");
        const target = (playlistSyncId && allPls.find((p: any) => p.syncId === playlistSyncId))
          || (playlistTitle && allPls.find((p: any) => p.title === playlistTitle));
        if (!target) break;
        const filtered = (target.videos ?? []).filter((v: any) => v.videoId !== videoId);
        if (filtered.length === (target.videos ?? []).length) break; // video wasn't here, nothing to do
        updatePlaylistVideos(target.title, filtered as CardVideo[]);
        setters.current.setPlaylists(getPlaylists());
        log.debug("[presence] video:delete applied", { playlist: target.title, videoId });
        break;
      }

      // ── Bidirectional pairing — confirmation required ──────────────────────
      case "pair:request": {
        const { fromCode, senderName, senderPlatform } = msg as any;
        const normalised = (fromCode as string).replace(/-/g, "");

        // Use settingsRef to read the current linkedDevices — avoids the stale
        // closure that would make this always read the mount-time empty array.
        const currentLinked: LinkedDevice[] = settingsRef.current.linkedDevices ?? [];
        const alreadyLinked = currentLinked.find(
          (d: LinkedDevice) => d.code.replace(/-/g, "") === normalised
        );

        if (alreadyLinked) {
          // Already paired — just acknowledge so the server confirms the pair
          presenceService.sendPairAccept(fromCode, resolveDeviceName(settingsRef.current.deviceName, fromCode));
          break;
        }

        // New device — show a confirmation toast the user must actively accept
        const deviceLabel = resolveDeviceName(senderName, fromCode);
        notifications.show({
          id: `pair-req-${fromCode}`,
          title: "Pairing request",
          message: `"${deviceLabel}" wants to link with this device. Accept from Settings → Device Sync.`,
          color: "blue",
          autoClose: 30_000,
        });
        // Store pending request so SyncSettings can render Accept/Reject buttons
        setSettings((prev: any) => ({
          ...prev,
          _pendingPairRequest: { fromCode, senderName: deviceLabel, senderPlatform: senderPlatform ?? "other" },
        }));
        break;
      }

      // Server confirmed both sides have accepted the pairing
      case "pair:confirmed": {
        const { fromCode, acceptorName } = msg as any;
        setSettings((prev: any) => {
          const existing: LinkedDevice[] = prev.linkedDevices ?? [];
          const normalised = (fromCode as string).replace(/-/g, "");
          if (existing.find((d: LinkedDevice) => d.code.replace(/-/g, "") === normalised)) return prev;
          const newDevice: LinkedDevice = {
            code: fromCode,
            // Use the acceptor's name if the server relayed it; fall back to generated name
            name: resolveDeviceName(acceptorName || null, fromCode),
            platform: "other",
            pairedAt: new Date().toISOString(),
            lastSyncAt: "",
          };
          const updated = [...existing, newDevice];
          db.update("settings", { ID: 1 }, (row: any) => ({ ...row, linkedDevices: updated }));
          db.commit();
          notifications.show({
            title: "Device paired!",
            message: `"${newDevice.name}" is now linked`,
            color: "teal",
            autoClose: 5000,
          });
          return { ...prev, linkedDevices: updated, _pendingPairRequest: undefined };
        });
        break;
      }

      // A paired device revoked — remove it from our linked list
      case "pair:revoked": {
        const { fromCode } = msg as any;
        setSettings((prev: any) => {
          const updated = (prev.linkedDevices ?? []).filter(
            (d: LinkedDevice) => d.code !== fromCode
          );
          db.update("settings", { ID: 1 }, (row: any) => ({ ...row, linkedDevices: updated }));
          db.commit();
          notifications.show({
            title: "Device unlinked",
            message: "A paired device removed this connection",
            color: "gray",
            autoClose: 4000,
          });
          return { ...prev, linkedDevices: updated };
        });
        break;
      }
    } // end switch (msg.type)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSettings]);

  // ── Remote command execution ──────────────────────────────────────────────
  const handleRemoteCommand = (command: RemoteCommand) => {
    const audio = (document.querySelector("audio") as HTMLAudioElement | null);
    switch (command) {
      case "play":
        audio?.play().catch(() => {});
        setPlayerState((s: any) => ({ ...s, paused: false }));
        break;
      case "pause":
        audio?.pause();
        setPlayerState((s: any) => ({ ...s, paused: true }));
        break;
      case "next": {
        // Try the data-action button first (desktop drawer), fallback to context
        const nextBtn = document.querySelector<HTMLButtonElement>("[data-action='next']");
        if (nextBtn && !nextBtn.disabled) {
          nextBtn.click();
        } else {
          // Read latest videoIds from a module-level ref updated below
          const vid = nextVideoIdRef.current;
          if (vid) handlePlayRef.current?.(vid);
        }
        break;
      }
      case "prev": {
        const prevBtn = document.querySelector<HTMLButtonElement>("[data-action='prev']");
        if (prevBtn && !prevBtn.disabled) {
          prevBtn.click();
        } else {
          const vid = prevVideoIdRef.current;
          if (vid) handlePlayRef.current?.(vid);
        }
        break;
      }
    }
  };

  // ── Broadcast own presence when track changes ─────────────────────────────
  const lastVideoId = useRef<string | null>(null);
  const lastPaused  = useRef<boolean | null>(null);

  useEffect(() => {
    if (!linkedCodes.length) return;
    const paused = playerState?.paused ?? true;
    const changed = video?.videoId !== lastVideoId.current || paused !== lastPaused.current;
    if (!changed) return;
    lastVideoId.current = video?.videoId ?? null;
    lastPaused.current  = paused;

    const state: PresenceState | null = video
      ? { videoId: video.videoId, title: video.title, author: video.author, thumbnailUrl: thumbnailUrl ?? "", paused }
      : null;

    presenceService.broadcastPresence(state, linkedCodes);
  }, [video?.videoId, playerState?.paused, linkedCodes.join(",")]);

  // ── Send a heartbeat when we connect or gain new linked devices ────────────
  // This lets the other side's server know we're online even with no track playing.
  useEffect(() => {
    if (!linkedCodes.length || !wsConnected) return;
    // Broadcast a null presence = "I'm online but not playing anything"
    presenceService.broadcastPresence(null, linkedCodes);
    // Also push our data so the other side is up to date
    const payload = {
      version: 2,
      pushedAt: new Date().toISOString(),
      playlists: getAllPlaylists(),
      history: getVideosHistory().slice(0, 500),
      followedArtists: getFollowedArtists(),
    };
    presenceService.pushSync(payload, linkedCodes);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsConnected, linkedCodes.join(",")]); 

  // ── Auto-push when playlists change (e.g. song added/removed) ──────────────
  // Debounced 1 s so bulk imports don't flood the server.
  const playlistPushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!linkedCodesRef.current.length || !wsConnected) return;
    if (playlistPushTimer.current) clearTimeout(playlistPushTimer.current);
    playlistPushTimer.current = setTimeout(() => {
      const payload = {
        version: 2,
        pushedAt: new Date().toISOString(),
        playlists: getAllPlaylists(),
        history: getVideosHistory().slice(0, 500),
        followedArtists: getFollowedArtists(),
      };
      presenceService.pushSync(payload, linkedCodesRef.current);
      log.debug("[presence] auto-push after playlist change");
    }, 1000);
    return () => { if (playlistPushTimer.current) clearTimeout(playlistPushTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlists, wsConnected]);

  // ── Instant push sync when data changes ───────────────────────────────────
  // This is called explicitly from SyncSettings when user triggers a sync.
  const pushInstantSync = useCallback(() => {
    if (!linkedCodes.length) return;
    const payload = {
      version: 2,
      pushedAt: new Date().toISOString(),
      playlists: getAllPlaylists(),
      history: getVideosHistory().slice(0, 500),
      followedArtists: getFollowedArtists(),
    };
    presenceService.pushSync(payload, linkedCodes);
    log.debug("[presence] instant sync pushed", { targets: linkedCodes.length });
  }, [linkedCodes.join(",")]);

  /**
   * Send a video deletion to all currently linked devices.
   * Call once — iterates over all paired devices internally.
   * The server queues delivery for any device that is currently offline.
   */
  const sendVideoDelete = useCallback((playlistSyncId: string, playlistTitle: string, videoId: string) => {
    for (const code of linkedCodesRef.current) {
      presenceService.sendVideoDelete(code, playlistSyncId, playlistTitle, videoId);
    }
    log.debug("[presence] video delete sent", { targets: linkedCodesRef.current.length, videoId });
  }, []);

  return {
    myCode,
    wsConnected,
    devicePresences,
    pushInstantSync,
    sendVideoDelete,
  };
};
