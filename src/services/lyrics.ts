// Lyrics service using LRCLIB (free, open-source lyrics API)
// Docs: https://lrclib.net/docs

const LRCLIB_API = "https://lrclib.net/api";

export interface LyricLine {
  time: number; // seconds
  text: string;
}

export interface LyricsResult {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
  /** Parsed synced lines — populated after parsing */
  lines?: LyricLine[];
}

/**
 * Parse LRC format string into timed lines.
 * LRC format: [mm:ss.xx] lyric text
 */
export function parseLRC(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const lineRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;

  for (const raw of lrc.split("\n")) {
    const match = lineRegex.exec(raw.trim());
    if (!match) continue;
    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    const centis = parseInt(match[3].padEnd(3, "0").slice(0, 3), 10);
    const time = minutes * 60 + seconds + centis / 1000;
    const text = match[4].trim();
    lines.push({ time, text });
  }

  return lines.sort((a, b) => a.time - b.time);
}

/**
 * Search for lyrics by track name and artist.
 * Returns null if not found.
 */
export async function getLyrics(
  trackName: string,
  artistName: string,
  albumName?: string,
  duration?: number,
): Promise<LyricsResult | null> {
  try {
    const params = new URLSearchParams({ track_name: trackName, artist_name: artistName });
    if (albumName) params.set("album_name", albumName);
    if (duration) params.set("duration", String(Math.round(duration)));

    const res = await fetch(`${LRCLIB_API}/get?${params.toString()}`, {
      headers: { "Lrclib-Client": "Elysium Music Player" },
    });

    if (!res.ok) {
      // Try search as fallback
      return await searchLyrics(trackName, artistName);
    }

    const data: LyricsResult = await res.json();
    if (data.syncedLyrics) {
      data.lines = parseLRC(data.syncedLyrics);
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Search LRCLIB by query, returning the best match.
 */
async function searchLyrics(
  trackName: string,
  artistName: string,
): Promise<LyricsResult | null> {
  try {
    const params = new URLSearchParams({ q: `${artistName} ${trackName}` });
    const res = await fetch(`${LRCLIB_API}/search?${params.toString()}`, {
      headers: { "Lrclib-Client": "Elysium Music Player" },
    });
    if (!res.ok) return null;

    const results: LyricsResult[] = await res.json();
    if (!results.length) return null;

    // Find best match by track name similarity
    const best =
      results.find(
        (r) =>
          r.trackName.toLowerCase().includes(trackName.toLowerCase()) &&
          r.artistName.toLowerCase().includes(artistName.toLowerCase()),
      ) ?? results[0];

    if (best.syncedLyrics) {
      best.lines = parseLRC(best.syncedLyrics);
    }
    return best;
  } catch {
    return null;
  }
}

/**
 * Get the current lyric line index based on playback time.
 */
export function getCurrentLineIndex(lines: LyricLine[], currentTime: number): number {
  if (!lines.length) return -1;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= currentTime) {
      idx = i;
    } else {
      break;
    }
  }
  return idx;
}
