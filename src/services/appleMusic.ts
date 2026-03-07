/**
 * Apple Music / iTunes Search API
 * Free public API — no authentication required.
 * Docs: https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/
 *
 * Search results map to existing Card types so all existing UI (VideoCard,
 * ChannelCard, CardList, etc.) renders them without any changes.
 *
 * Playback: Apple Music track IDs are "virtual" — when the user clicks play,
 * usePlayVideo resolves the videoId to a real Invidious result by searching
 * "{artist} {title}".
 */

import type { CardChannel, CardVideo } from "../types/interfaces/Card";
import { log } from "../utils/logger";

// ─── ID Prefixes ──────────────────────────────────────────────────────────────

const AM_VIDEO_PREFIX = "am:";
export const AM_ARTIST_PREFIX = "am_artist:";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ItunesTrack {
  wrapperType: "track";
  trackId: number;
  trackName: string;
  artistName: string;
  collectionName?: string;
  artworkUrl100?: string;
  trackTimeMillis?: number;
  primaryGenreName?: string;
}

interface ItunesArtist {
  wrapperType: "artist";
  artistId: number;
  artistName: string;
  primaryGenreName?: string;
  artistLinkUrl?: string;
}

interface ItunesCollection {
  wrapperType: "collection";
  collectionId: number;
  collectionName: string;
  artistName: string;
  artworkUrl100?: string;
  releaseDate?: string;
}

type ItunesResult = ItunesTrack | ItunesArtist | ItunesCollection;

interface ItunesSearchResponse {
  resultCount: number;
  results: ItunesResult[];
}

interface ItunesLookupResponse {
  resultCount: number;
  results: ItunesCollection[];
}

// ─── ID Helpers ───────────────────────────────────────────────────────────────

/** Encode an Apple Music track to a virtual videoId */
export const encodeAppleMusicVideoId = (
  trackId: number,
  artist: string,
  title: string,
): string =>
  `${AM_VIDEO_PREFIX}${trackId}:${encodeURIComponent(artist)}:${encodeURIComponent(title)}`;

/** Check if a videoId is an Apple Music virtual ID */
export const isAppleMusicVideoId = (videoId: string): boolean =>
  videoId.startsWith(AM_VIDEO_PREFIX);

/** Decode an Apple Music virtual videoId back into artist + title for searching */
export const parseAppleMusicVideoId = (
  videoId: string,
): { trackId: string; artist: string; title: string } | null => {
  if (!isAppleMusicVideoId(videoId)) return null;
  const rest = videoId.slice(AM_VIDEO_PREFIX.length);
  const idx1 = rest.indexOf(":");
  const idx2 = rest.indexOf(":", idx1 + 1);
  if (idx1 === -1 || idx2 === -1) return null;
  return {
    trackId: rest.slice(0, idx1),
    artist: decodeURIComponent(rest.slice(idx1 + 1, idx2)),
    title: decodeURIComponent(rest.slice(idx2 + 1)),
  };
};

/** Check if an authorId is an Apple Music artist */
export const isAppleMusicArtistId = (authorId: string): boolean =>
  authorId.startsWith(AM_ARTIST_PREFIX);

/** Extract the numeric iTunes artist ID from a CardChannel authorId */
export const getItunesArtistId = (authorId: string): string =>
  authorId.slice(AM_ARTIST_PREFIX.length);

// ─── Artwork helper ───────────────────────────────────────────────────────────

const upgradeArtwork = (url?: string, size = 300): string => {
  if (!url) return "";
  return url.replace("100x100", `${size}x${size}`).replace("bb.jpg", "bb.jpg");
};

// ─── Search ───────────────────────────────────────────────────────────────────

/** Search Apple Music / iTunes catalog and return Card-compatible results */
export const searchAppleMusic = async (
  query: string,
  limit = 20,
): Promise<Array<CardVideo | CardChannel>> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    // Try musicTrack+musicArtist first, fall back to musicTrack only if needed
    for (const entity of ["musicTrack,musicArtist", "musicTrack"]) {
      const params = new URLSearchParams({
        term: query,
        media: "music",
        entity,
        limit: String(Math.min(limit, 50)),
        lang: "en_us",
      });
      const url = `/api/itunes-proxy/search?${params}`;

      try {
        const res = await fetch(url, { signal: controller.signal });
        if (res.status === 403 || res.status === 429) {
          // Rate limited — throw so caller falls back to Invidious
          throw new Error(`iTunes API rate limited: ${res.status}`);
        }
        if (!res.ok) continue; // try next entity variant

        const data: ItunesSearchResponse = await res.json();
        const cards: Array<CardVideo | CardChannel> = [];

        for (const item of data.results) {
          if (item.wrapperType === "track") {
            const t = item as ItunesTrack;
            if (!t.trackId || !t.trackName) continue;
            cards.push({
              type: "video",
              videoId: encodeAppleMusicVideoId(t.trackId, t.artistName ?? "", t.trackName),
              title: `${t.trackName}${t.collectionName ? ` — ${t.collectionName}` : ""}`,
              thumbnail: upgradeArtwork(t.artworkUrl100),
              liveNow: false,
              lengthSeconds: t.trackTimeMillis ? Math.floor(t.trackTimeMillis / 1000) : 0,
              videoThumbnails: [],
            } as CardVideo);
          } else if (item.wrapperType === "artist") {
            const a = item as ItunesArtist;
            if (!a.artistId || !a.artistName) continue;
            cards.push({
              type: "channel",
              author: a.artistName,
              authorId: `${AM_ARTIST_PREFIX}${a.artistId}`,
              authorVerified: false,
              videoCount: 0,
              description: a.primaryGenreName ?? "Artist on Apple Music",
              subCount: 0,
              thumbnail: "",
              authorThumbnails: [],
            } as CardChannel);
          }
        }

        if (cards.length > 0) return cards;
      } catch (inner) {
        // Re-throw rate limit errors so the caller knows to fall back
        if (inner instanceof Error && inner.message.includes("rate limited")) throw inner;
        // Otherwise ignore and try next entity variant
      }
    }
    return [];
  } catch (err) {
    log.warn("searchAppleMusic failed", { query, err });
    throw err; // propagate so search.ts can fall back to Invidious
  } finally {
    clearTimeout(timer);
  }
};

// ─── Latest release lookup ────────────────────────────────────────────────────

export interface LatestRelease {
  name: string;
  releaseDate: string; // ISO
  artworkUrl?: string;
}

/** Get the most recent album/single from an iTunes artist ID */
export const getLatestRelease = async (
  itunesArtistId: string,
): Promise<LatestRelease | null> => {
  try {
    const url = `/api/itunes-proxy/lookup?id=${itunesArtistId}&entity=album&limit=5&sort=recent`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data: ItunesLookupResponse = await res.json();
    // results[0] is the artist itself, albums start at [1]
    const albums = data.results.filter((r) => r.wrapperType === "collection");
    if (!albums.length) return null;
    const latest = albums[0] as ItunesCollection;
    return {
      name: latest.collectionName,
      releaseDate: latest.releaseDate ?? "",
      artworkUrl: upgradeArtwork(latest.artworkUrl100, 200),
    };
  } catch {
    return null;
  }
};
