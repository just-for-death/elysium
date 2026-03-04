import { db } from ".";
import { getCardId } from "../components/ButtonFavorite";
import type { Card, CardPlaylist, CardVideo } from "../types/interfaces/Card";
import type { FavoritePlaylist, Playlist } from "../types/interfaces/Playlist";
import type { SearchHistory } from "../types/interfaces/Search";
import type { Instance } from "../types/interfaces/Instance";
import type { Settings } from "../types/interfaces/Settings";
import { normalizeInstanceUri } from "../utils/invidiousInstance";

const sanitizeInstanceUri = (inst: Instance | null | undefined): Instance | null | undefined => {
  if (!inst) return inst;
  const uri = normalizeInstanceUri(inst.uri);
  return uri ? { ...inst, uri } : inst;
};

export const getSettings = (): Settings => {
  const settings = db.queryAll("settings", { query: { ID: 1 } })[0] ?? {};
  return {
    ...settings,
    devices: settings.devices ?? [],
    listenBrainzToken: settings.listenBrainzToken || null,
    listenBrainzUsername: settings.listenBrainzUsername || null,
    listenBrainzEnabled: settings.listenBrainzEnabled ?? false,
    listenBrainzPlayingNow: settings.listenBrainzPlayingNow ?? true,
    currentInstance: sanitizeInstanceUri(settings.currentInstance),
    defaultInstance: sanitizeInstanceUri(settings.defaultInstance),
    gotifyUrl: settings.gotifyUrl || null,
    gotifyToken: settings.gotifyToken || null,
    gotifyEnabled: settings.gotifyEnabled ?? false,
    syncEnabled: settings.syncEnabled ?? false,
    syncInterval: settings.syncInterval ?? 30,
    lastSyncAt: settings.lastSyncAt ?? "",
    linkedDevices: settings.linkedDevices ?? [],
    invidiousSid: settings.invidiousSid || null,
    invidiousUsername: settings.invidiousUsername || null,
    invidiousLoginInstance: settings.invidiousLoginInstance || null,
    invidiousPlaylistMappings: settings.invidiousPlaylistMappings ?? {},
    invidiousAutoPush: settings.invidiousAutoPush ?? false,
  };
};

export const getFavoritePlaylist = (): FavoritePlaylist => {
  return db.queryAll("playlists", { query: { title: "Favorites" } })[0];
};

export const getCachePlaylist = (): Playlist | undefined => {
  return db.queryAll("playlists", { query: { title: "Cache" } })[0];
};

export const updateCachePlaylist = (videos: CardVideo[]): void => {
  const existing = db.queryAll("playlists", { query: { title: "Cache" } })[0];
  if (existing) {
    db.update("playlists", { title: "Cache" }, (raw: Playlist) => ({
      ...raw,
      videos,
      videoCount: videos.length,
    }));
  } else {
    db.insert("playlists", {
      createdAt: new Date().toISOString(),
      title: "Cache",
      videos,
      videoCount: videos.length,
      type: "cache",
    });
  }
  db.commit();
};

export const removeDuplicateVideoId = (cards: Card[]): Card[] => {
  return cards.filter(
    (value, index, self) =>
      index === self.findIndex((t) => getCardId(t) === getCardId(value)),
  );
};

export const importVideosToFavorites = (importedCards: Card[]): void => {
  db.update("playlists", { title: "Favorites" }, (raw: FavoritePlaylist) => ({
    ...raw,
    cards: removeDuplicateVideoId([...importedCards, ...(raw.cards ?? [])]),
  }));
  db.commit();
};

export const importPlaylist = (playlist: CardPlaylist): void => {
  db.insert("playlists", {
    createdAt: new Date().toISOString(),
    title: playlist.title,
    videos: playlist.videos,
    videoCount: playlist.videoCount,
    type: "playlist",
  });
  db.commit();
};

export const updatePlaylistVideos = (title: string, videos: CardVideo[]) => {
  db.update("playlists", { title }, (raw: Playlist) => ({
    ...raw,
    videos,
  }));
  db.commit();
};

export const getPlaylists = (): Playlist[] => {
  return db.queryAll("playlists", {
    query: (row: Playlist) => row.title !== "Favorites",
  });
};

export const getAllPlaylists = (): CardPlaylist[] => {
  return db.queryAll("playlists");
};

export const getPlaylist = (playlistId: number): Playlist => {
  return db.queryAll("playlists", { query: { ID: playlistId } })[0];
};

export const getVideosHistory = (): CardVideo[] => {
  return db.queryAll("history", {
    sort: [["ID", "DESC"]],
  });
};

export const getLastVideoPlayed = (): CardVideo => {
  return getVideosHistory()[0];
};

export const getSearchHistory = (): SearchHistory[] => {
  return db.queryAll("searchHistory", {
    sort: [["ID", "DESC"]],
    limit: 5,
  });
};
