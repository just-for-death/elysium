import { useLocation } from "react-router-dom";

import {
  getFavoritePlaylist,
  getPlaylist as getLocalPlaylist,
  getSettings,
} from "../database/utils";
import { queryClient } from "../queryClient";
import type { Playlist } from "../types/interfaces/Playlist";
import type { Video } from "../types/interfaces/Video";

// FIX: safe helper – queryClient.getQueriesData() returns [] if query hasn't loaded yet,
// so [0] would be undefined → crash. Guard every access.
const safeGetQueryData = <T>(key: string): T | null => {
  try {
    const results = queryClient.getQueriesData(key);
    return (results?.[0]?.[1] as T) ?? null;
  } catch {
    return null;
  }
};

export const useResolveVideosPlaylist = () => {
  const location = useLocation();

  const getVideosPlaylist = () => {
    // When any auto-queue mode (other than "invidious" and "off") is enabled,
    // always return null so that usePlayVideo falls through to [currentVideo].
    // Without this, pages like Most Popular / Trending fill the queue with their
    // entire video list, bypassing the auto-queue hook.
    // Explicit playlists (/playlists/…) are still respected.
    const settings = getSettings();
    const queueMode: string = (settings as any).queueMode ?? "off";
    const legacyOllama = settings.ollamaEnabled && !!settings.ollamaUrl;
    const effectiveMode = queueMode !== "off" ? queueMode : legacyOllama ? "ollama" : "off";
    const autoQueueActive = effectiveMode !== "off" && effectiveMode !== "invidious";
    if (autoQueueActive && !location.pathname.includes("/playlists/")) {
      return null;
    }

    let videos: Video[] | null = null;

    if (location.pathname.includes("/playlists/")) {
      const [, , playlistId] = window.location.pathname.split("/");
      const isLocalPlaylist = Number(playlistId);

      if (isLocalPlaylist) {
        const playlist = getLocalPlaylist(Number(playlistId));
        videos = playlist?.videos ? (playlist.videos as Video[]) : null;
      } else {
        const remotePlaylist = safeGetQueryData<Playlist>(
          `playlist-${playlistId}`,
        );
        videos = (remotePlaylist?.videos as Video[]) ?? null;
      }
    }
    if (location.pathname.includes("/channels/")) {
      const [, , authorId] = window.location.pathname.split("/");
      const query = safeGetQueryData<{ data: Video[] }>(
        `channels-${authorId}-videos-1`,
      );
      videos = query?.data ?? null;
    }
    if (location.pathname === "/favorites") {
      const fav = getFavoritePlaylist();
      videos =
        (fav?.cards?.filter((card) => card.type === "video") as Video[]) ??
        null;
    }
    if (location.pathname === "/most-popular") {
      videos = safeGetQueryData<Video[]>("most-popular");
    }
    if (location.pathname === "/trending") {
      videos = safeGetQueryData<Video[]>("trending");
    }

    return videos;
  };

  return getVideosPlaylist;
};
