import type { Playlist } from "../types/interfaces/Playlist";
import { getCurrentInstance } from "../utils/getCurrentInstance";
import { normalizeInstanceUri } from "../utils/invidiousInstance";

export const getPlaylist = async (playlistId: string): Promise<Playlist> => {
  const base = normalizeInstanceUri(getCurrentInstance().uri);
  const request = await fetch(`${base}/api/v1/playlists/${playlistId}`);
  if (!request.ok) throw new Error(`Playlist fetch failed: ${request.status}`);
  const data = await request.json();
  return data;
};
