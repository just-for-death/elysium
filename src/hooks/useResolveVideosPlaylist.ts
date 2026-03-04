import { useLocation } from "react-router-dom";

import {
  getFavoritePlaylist,
  getPlaylist as getLocalPlaylist,
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
