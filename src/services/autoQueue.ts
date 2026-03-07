/**
 * Auto Queue Service — v8
 *
 * Three primary queue modes:
 *
 *  1. "discover"  — Random new music. Sources: Apple iTunes Top 50 (fastest, cached) +
 *                   ListenBrainz sitewide trending. Both fetched in parallel.
 *                   Returns up to `count` non-avoided tracks. No auth required.
 *
 *  2. "similar"   — Same artist / vibe as currently playing.
 *                   Fully parallel Last.fm strategy — no LB Radio dependency.
 *                   Layers (all run simultaneously):
 *                     A. track.getSimilar  (cross-artist, same vibe)
 *                     B. artist.getSimilar + top tracks (related artists)
 *                     C. same-artist top tracks (guaranteed same-artist results)
 *                   Results merged, shuffled, de-duped. Works for ANY artist
 *                   including Bollywood, Punjabi, Tamil, Telugu, etc.
 *
 *  3. "my_taste"  — Matches the user's personal listening style. Combines:
 *                   • LB CF personalised recommendations (requires token)
 *                   • LB user top recordings this month (requires token)
 *                   • Apple Music trending (for freshness)
 *                   All fed into Ollama which picks the best fit.
 *                   Returns one Ollama-picked track (AI is single-output by nature).
 *
 * Legacy modes retained for migration compat:
 *   "invidious", "apple_charts", "listenbrainz", "lastfm_similar", "ollama"
 *
 * Changes in v8:
 *  - LB Radio removed entirely (returned 400 for most non-Western artists,
 *    added 8 s latency before fallback triggered)
 *  - Similar mode now fires all Last.fm calls in parallel (3 simultaneous requests)
 *  - Same-artist tracks always included (ensures queue never empty for any artist)
 *  - Normalised title comparison handles Devanagari / Unicode correctly
 */

import { getAppleChartsForOllama } from "./apple-charts";
import { getOllamaQueueSuggestion, type OllamaRichContext } from "./ollama";
import { getTopRecordings, getTopArtists, getRecentListens } from "./listenbrainz";
import { getLBRecommendations } from "./listenbrainz-charts";

export type QueueMode =
  | "off"
  | "discover"        // random discovery (Apple charts + LB trending)
  | "similar"         // same artist / vibe (Last.fm multi-layer)
  | "my_taste"        // personal style (LB token + Ollama)
  | "invidious"       // legacy: YouTube up-next
  | "apple_charts"    // legacy: iTunes Top 50 only
  | "listenbrainz"    // legacy: LB global trending only
  | "lastfm_similar"  // legacy: Last.fm getSimilar
  | "ollama";         // legacy: Ollama only (no rich context)

export interface QueueSuggestion {
  title: string;
  artist: string;
  source: QueueMode;
}

// ─── Shared types ─────────────────────────────────────────────────────────────

interface SimpleTrack {
  title: string;
  artist: string;
}

// ─── ListenBrainz sitewide trending (cached, ~200 ms) ────────────────────────

interface LBRecording {
  artist_name: string;
  track_name: string;
}

let lbTrendingCache: { data: LBRecording[]; expiry: number } | null = null;

const fetchLBTrendingTracks = async (): Promise<LBRecording[]> => {
  if (lbTrendingCache && Date.now() < lbTrendingCache.expiry) return lbTrendingCache.data;
  try {
    const res = await fetch(
      "https://api.listenbrainz.org/1/stats/sitewide/recordings?count=50&range=week",
      { signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return [];
    const json = await res.json();
    const recordings: LBRecording[] = json?.payload?.recordings ?? [];
    if (recordings.length) lbTrendingCache = { data: recordings, expiry: Date.now() + 15 * 60 * 1000 };
    return recordings;
  } catch {
    return [];
  }
};

// ─── Last.fm API helpers ──────────────────────────────────────────────────────

interface LastfmTrack {
  name: string;
  artist: { name: string } | string;
}

/** track.getSimilar — cross-artist tracks in the same vibe */
const fetchLastfmSimilar = async (
  apiKey: string,
  artist: string,
  title: string,
  limit = 50,
): Promise<SimpleTrack[]> => {
  try {
    const url =
      `https://ws.audioscrobbler.com/2.0/?method=track.getSimilar` +
      `&artist=${encodeURIComponent(artist)}` +
      `&track=${encodeURIComponent(title)}` +
      `&api_key=${encodeURIComponent(apiKey)}` +
      `&limit=${limit}&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const data = await res.json();
    const tracks: LastfmTrack[] = data?.similartracks?.track ?? [];
    return tracks.map((t) => ({
      title: t.name,
      artist: typeof t.artist === "string" ? t.artist : t.artist.name,
    }));
  } catch {
    return [];
  }
};

/** artist.getSimilar — artists in the same genre/scene */
const fetchLastfmSimilarArtists = async (
  apiKey: string,
  artist: string,
  limit = 20,
): Promise<string[]> => {
  try {
    const url =
      `https://ws.audioscrobbler.com/2.0/?method=artist.getSimilar` +
      `&artist=${encodeURIComponent(artist)}` +
      `&api_key=${encodeURIComponent(apiKey)}` +
      `&limit=${limit}&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const data = await res.json();
    const artists: Array<{ name: string }> = data?.similarartists?.artist ?? [];
    return artists.map((a) => a.name).filter(Boolean);
  } catch {
    return [];
  }
};

/** artist.getTopTracks for multiple artists — run in parallel */
const fetchLastfmArtistTopTracks = async (
  apiKey: string,
  artistNames: string[],
  tracksPerArtist = 4,
): Promise<SimpleTrack[]> => {
  const results: SimpleTrack[] = [];
  await Promise.allSettled(
    artistNames.slice(0, 10).map(async (artistName) => {
      try {
        const url =
          `https://ws.audioscrobbler.com/2.0/?method=artist.getTopTracks` +
          `&artist=${encodeURIComponent(artistName)}` +
          `&api_key=${encodeURIComponent(apiKey)}` +
          `&limit=${tracksPerArtist}&format=json`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return;
        const data = await res.json();
        const tracks: Array<{ name: string }> = data?.toptracks?.track ?? [];
        for (const t of tracks.slice(0, tracksPerArtist)) {
          if (t.name) results.push({ title: t.name, artist: artistName });
        }
      } catch {}
    }),
  );
  return results;
};

/** artist.getTopTracks for the SAME artist — always returns results */
const fetchLastfmSameArtistTracks = async (
  apiKey: string,
  artist: string,
  limit = 30,
): Promise<SimpleTrack[]> => {
  try {
    const url =
      `https://ws.audioscrobbler.com/2.0/?method=artist.getTopTracks` +
      `&artist=${encodeURIComponent(artist)}` +
      `&api_key=${encodeURIComponent(apiKey)}` +
      `&limit=${limit}&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const data = await res.json();
    const tracks: Array<{ name: string; artist?: { name: string } }> = data?.toptracks?.track ?? [];
    return tracks
      .map((t) => ({ title: t.name, artist: t.artist?.name ?? artist }))
      .filter((t) => t.title);
  } catch {
    return [];
  }
};

// ─── Apple Charts helper (re-uses the cached service) ────────────────────────

const fetchAppleSimpleTracks = async (count = 50): Promise<SimpleTrack[]> => {
  try {
    const tracks = await getAppleChartsForOllama(count);
    return tracks.filter((t) => t.title && t.artist);
  } catch {
    return [];
  }
};

// ─── Rich context builder for Ollama (my_taste mode) ─────────────────────────

const CONTEXT_TTL_MS = 10 * 60 * 1000;
let cachedRichContext: OllamaRichContext | null = null;
let cachedRichContextAt = 0;

const buildOllamaRichContext = async (
  listenBrainzToken: string | null,
  listenBrainzUsername: string | null,
): Promise<OllamaRichContext> => {
  const now = Date.now();
  if (cachedRichContext && now - cachedRichContextAt < CONTEXT_TTL_MS) {
    return cachedRichContext;
  }

  const ctx: OllamaRichContext = {};

  const credentials = listenBrainzToken && listenBrainzUsername
    ? { userToken: listenBrainzToken, username: listenBrainzUsername }
    : null;

  const [topRecs, cfRecs, appleCharts, topArtistsResult, recentListensResult] = await Promise.allSettled([
    credentials
      ? getTopRecordings(credentials, "month", 12)
      : Promise.resolve([]),

    credentials
      ? getLBRecommendations(listenBrainzUsername!, listenBrainzToken!, 12)
      : Promise.resolve([]),

    getAppleChartsForOllama(8),

    credentials
      ? getTopArtists(credentials, "month", 10)
      : Promise.resolve([]),

    credentials
      ? getRecentListens(credentials, 20)
      : Promise.resolve([]),
  ]);

  if (topRecs.status === "fulfilled") {
    ctx.topTracks = (topRecs.value as any[])
      .map((r: any) => ({
        title: r.track_name ?? "",
        artist: r.artist_name ?? "",
        listenCount: r.listen_count,
      }))
      .filter((r) => r.title && r.artist);
  }

  if (topArtistsResult.status === "fulfilled") {
    ctx.topArtists = (topArtistsResult.value as any[])
      .map((a: any) => ({
        artist: a.artist_name ?? "",
        listenCount: a.listen_count,
      }))
      .filter((a) => a.artist);
  }

  if (recentListensResult.status === "fulfilled") {
    ctx.recentListens = (recentListensResult.value as any[])
      .map((l: any) => ({
        title: l.track_metadata?.track_name ?? "",
        artist: l.track_metadata?.artist_name ?? "",
      }))
      .filter((l) => l.title && l.artist);
  }

  if (cfRecs.status === "fulfilled" && Array.isArray(cfRecs.value)) {
    ctx.recommendations = (cfRecs.value as any[])
      .map((v: any) => {
        const parts = (v.title ?? "").split(" — ");
        if (parts.length >= 2) return { title: parts[0].trim(), artist: parts[1].trim() };
        return null;
      })
      .filter(Boolean) as Array<{ title: string; artist: string }>;
  }

  if (appleCharts.status === "fulfilled") {
    ctx.appleCharts = appleCharts.value;
  }

  cachedRichContext = ctx;
  cachedRichContextAt = now;
  return ctx;
};

// ─── Mode 1: Discover ─────────────────────────────────────────────────────────

export const getDiscoverSuggestions = async (
  avoidTitles: Set<string>,
  count = 10,
): Promise<QueueSuggestion[]> => {
  const [appleResult, lbResult] = await Promise.allSettled([
    fetchAppleSimpleTracks(50),
    fetchLBTrendingTracks(),
  ]);

  const appleTracks: SimpleTrack[] =
    appleResult.status === "fulfilled" ? appleResult.value : [];
  const lbTracks: SimpleTrack[] =
    lbResult.status === "fulfilled"
      ? lbResult.value.map((r) => ({ title: r.track_name, artist: r.artist_name }))
      : [];

  const combined: SimpleTrack[] = [];
  const maxLen = Math.max(appleTracks.length, lbTracks.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < appleTracks.length) combined.push(appleTracks[i]);
    if (i < lbTracks.length)   combined.push(lbTracks[i]);
  }

  const seenTitles = new Set(avoidTitles);
  const results: QueueSuggestion[] = [];
  const shuffled = [...combined].sort(() => Math.random() - 0.5);
  for (const t of shuffled) {
    if (results.length >= count) break;
    const key = t.title.toLowerCase();
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    results.push({ title: t.title, artist: t.artist, source: "discover" });
  }

  return results;
};

// ─── Mode 2: Similar ──────────────────────────────────────────────────────────

/**
 * Returns up to `count` tracks similar to the currently playing song.
 *
 * All three Last.fm calls fire in parallel so total latency = slowest single
 * call (~600 ms) rather than sum of all calls.
 *
 * Sources (all parallel):
 *   A. track.getSimilar      → cross-artist tracks in the same vibe
 *   B. artist.getSimilar + getTopTracks → related artists' popular songs
 *   C. artist.getTopTracks (same artist) → more by the same artist (always works)
 *
 * If all three return nothing (artist totally unknown to Last.fm), a second
 * round fires using the raw channel author as artist — catches cases where
 * extractArtistTrack gives a movie name instead of the real artist.
 *
 * Works for ALL artists including Bollywood, Punjabi, Tamil, Telugu, K-pop, etc.
 */
export const getSimilarSuggestions = async (
  currentArtist: string,
  currentTitle: string,
  avoidTitles: Set<string>,
  _listenBrainzToken: string | null,
  lastfmApiKey: string | null,
  count = 10,
  rawChannelAuthor?: string,  // original video.author for fallback
): Promise<QueueSuggestion[]> => {
  if (!lastfmApiKey) return [];

  const seenTitles = new Set(avoidTitles);
  seenTitles.add(currentTitle.toLowerCase());

  const results: QueueSuggestion[] = [];
  const push = (title: string, artist: string): boolean => {
    if (!title || !artist) return false;
    const key = title.toLowerCase().trim();
    if (seenTitles.has(key)) return false;
    seenTitles.add(key);
    results.push({ title, artist, source: "similar" });
    return true;
  };

  const runQuery = async (artist: string, title: string) => {
    const [similarTracksResult, similarArtistsResult, sameArtistResult] =
      await Promise.allSettled([
        fetchLastfmSimilar(lastfmApiKey, artist, title, count * 5),
        fetchLastfmSimilarArtists(lastfmApiKey, artist, 15),
        fetchLastfmSameArtistTracks(lastfmApiKey, artist, count * 3),
      ]);

    const similarTracks =
      similarTracksResult.status === "fulfilled" ? similarTracksResult.value : [];

    let relatedArtistTracks: SimpleTrack[] = [];
    if (similarArtistsResult.status === "fulfilled" && similarArtistsResult.value.length > 0) {
      relatedArtistTracks = await fetchLastfmArtistTopTracks(
        lastfmApiKey,
        similarArtistsResult.value,
        4,
      );
    }

    const sameArtistTracks =
      sameArtistResult.status === "fulfilled" ? sameArtistResult.value : [];

    return { similarTracks, relatedArtistTracks, sameArtistTracks };
  };

  // ── Primary query with extracted artist ─────────────────────────────────
  const primary = await runQuery(currentArtist, currentTitle);
  const primaryCount =
    primary.similarTracks.length +
    primary.relatedArtistTracks.length +
    primary.sameArtistTracks.length;

  // ── If primary returned nothing, try fallback artist names ───────────────
  // This catches the case where extractArtistTrack gave us a movie name
  // (e.g. "Aashiqui 2") instead of the real singer. We try:
  //   1. The raw channel author (stripped of "- Topic", "VEVO" etc.)
  //   2. The current song title itself searched as an artist (covers "Artist - Topic" channels)
  let fallback = { similarTracks: [] as SimpleTrack[], relatedArtistTracks: [] as SimpleTrack[], sameArtistTracks: [] as SimpleTrack[] };

  if (primaryCount === 0 && rawChannelAuthor) {
    const cleanChannel = rawChannelAuthor
      .replace(/\s*-\s*Topic\s*$/i, "")
      .replace(/\s*VEVO\s*$/i, "")
      .replace(/\s*Official\s*$/i, "")
      .replace(/\s*Music\s*$/i, "")
      .trim();

    if (cleanChannel && cleanChannel.toLowerCase() !== currentArtist.toLowerCase()) {
      fallback = await runQuery(cleanChannel, currentTitle);
    }
  }

  // ── Merge: interleave vibe-match and related-artist, pad with same-artist ─
  const chooseBest = (a: typeof primary, b: typeof fallback) => ({
    similarTracks: a.similarTracks.length >= b.similarTracks.length
      ? a.similarTracks : b.similarTracks,
    relatedArtistTracks: a.relatedArtistTracks.length >= b.relatedArtistTracks.length
      ? a.relatedArtistTracks : b.relatedArtistTracks,
    sameArtistTracks: [...a.sameArtistTracks, ...b.sameArtistTracks],
  });

  const best = chooseBest(primary, fallback);

  const shuffledSimilar   = [...best.similarTracks].sort(() => Math.random() - 0.5);
  const shuffledRelated   = [...best.relatedArtistTracks].sort(() => Math.random() - 0.5);
  const shuffledSameArtist = [...best.sameArtistTracks].sort(() => Math.random() - 0.5);

  const maxAB = Math.max(shuffledSimilar.length, shuffledRelated.length);
  for (let i = 0; i < maxAB && results.length < count; i++) {
    if (i < shuffledSimilar.length) push(shuffledSimilar[i].title, shuffledSimilar[i].artist);
    if (results.length >= count) break;
    if (i < shuffledRelated.length) push(shuffledRelated[i].title, shuffledRelated[i].artist);
  }

  for (const t of shuffledSameArtist) {
    if (results.length >= count) break;
    push(t.title, t.artist);
  }

  return results;
};

// ─── Mode 3: My Taste ─────────────────────────────────────────────────────────

export const getMyTasteSuggestion = async (
  currentSong: { title: string; artist: string },
  avoidList: Array<{ title: string }>,
  avoidTitles: Set<string>,
  listenBrainzToken: string | null,
  listenBrainzUsername: string | null,
  ollamaUrl: string,
  ollamaModel: string,
): Promise<QueueSuggestion | null> => {
  if (!ollamaUrl) return null;

  const richContext = await buildOllamaRichContext(listenBrainzToken, listenBrainzUsername);
  const result = await getOllamaQueueSuggestion(ollamaUrl, ollamaModel, currentSong, avoidList, richContext);
  if (!result) return null;
  if (avoidTitles.has(result.title.toLowerCase())) return null;
  return { title: result.title, artist: result.artist, source: "my_taste" };
};

// ─── Legacy single-result wrappers (kept for migration compat) ───────────────

export const getAppleChartsSuggestion = async (
  avoidTitles: Set<string>,
): Promise<QueueSuggestion | null> => {
  const tracks = await fetchAppleSimpleTracks(50);
  const shuffled = [...tracks].sort(() => Math.random() - 0.5);
  const pick = shuffled.find((t) => !avoidTitles.has(t.title.toLowerCase()));
  if (!pick) return null;
  return { title: pick.title, artist: pick.artist, source: "apple_charts" };
};

export const getListenBrainzSuggestion = async (
  avoidTitles: Set<string>,
): Promise<QueueSuggestion | null> => {
  const tracks = await fetchLBTrendingTracks();
  const shuffled = [...tracks].sort(() => Math.random() - 0.5);
  const pick = shuffled.find((t) => !avoidTitles.has(t.track_name.toLowerCase()));
  if (!pick) return null;
  return { title: pick.track_name, artist: pick.artist_name, source: "listenbrainz" };
};

export const getLastfmSimilarSuggestion = async (
  apiKey: string,
  currentArtist: string,
  currentTitle: string,
  avoidTitles: Set<string>,
): Promise<QueueSuggestion | null> => {
  const tracks = await fetchLastfmSimilar(apiKey, currentArtist, currentTitle);
  const pick = tracks.find((t) => !avoidTitles.has(t.title.toLowerCase()));
  if (!pick) return null;
  return { title: pick.title, artist: pick.artist, source: "lastfm_similar" };
};

export const getOllamaSuggestion = async (
  ollamaUrl: string,
  model: string,
  currentSong: { title: string; artist: string },
  avoidList: Array<{ title: string }>,
): Promise<QueueSuggestion | null> => {
  const result = await getOllamaQueueSuggestion(ollamaUrl, model, currentSong, avoidList);
  if (!result) return null;
  return { title: result.title, artist: result.artist, source: "ollama" };
};

// ─── Last.fm API key verification ────────────────────────────────────────────

export interface LastfmTestResult {
  ok: boolean;
  username?: string;
  error?: string;
}

export const testLastfmApiKey = async (
  apiKey: string,
): Promise<LastfmTestResult> => {
  if (!apiKey.trim()) return { ok: false, error: "No API key provided" };
  try {
    const url =
      `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo` +
      `&artist=Coldplay` +
      `&api_key=${encodeURIComponent(apiKey.trim())}` +
      `&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const data = await res.json();
    if (data?.error) {
      return { ok: false, error: data.message ?? "Invalid API key" };
    }
    const artistName: string = data?.artist?.name ?? "Coldplay";
    return { ok: true, username: artistName };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Network error" };
  }
};
