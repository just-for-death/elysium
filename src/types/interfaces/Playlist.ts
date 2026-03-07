import type { Card } from "./Card";
import type { Video } from "./Video";

export interface Playlist {
  type: "playlist" | "cache";
  ID?: number;
  playlistId?: string;
  title: string;
  videos: Card[] | Video[];
  videoCount: number;
  playlistThumbnail: string;
  /** Permanent UUID for cross-device deduplication — never changes after creation */
  syncId?: string;
  /** ListenBrainz playlist MBID — updated after each push to LB */
  lbPlaylistId?: string;
}

export interface FavoritePlaylist extends Omit<Playlist, "title"> {
  title: "Favorites";
  cards: Card[];
}
