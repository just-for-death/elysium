/**
 * Lyrics service — multi-source with synced lyrics preference.
 *
 * Source priority (synced preferred over plain at every level):
 *  1. LRCLIB   — best for Western music, has synced LRC
 *  2. NetEase Cloud Music (via public API) — excellent for K-pop, J-pop, C-pop, Bollywood
 *  3. LRCLIB search fallback (looser query)
 */

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
  lines?: LyricLine[];
  source?: string;
}

// ─── LRC parser ───────────────────────────────────────────────────────────────

function parseLRC(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const lineRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;
  for (const raw of lrc.split("\n")) {
    const match = lineRegex.exec(raw.trim());
    if (!match) continue;
    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    const centis   = parseInt(match[3].padEnd(3, "0").slice(0, 3), 10);
    const time = minutes * 60 + seconds + centis / 1000;
    const text = match[4].trim();
    lines.push({ time, text });
  }
  return lines.sort((a, b) => a.time - b.time);
}

function attachLines(result: LyricsResult): LyricsResult {
  if (result.syncedLyrics) result.lines = parseLRC(result.syncedLyrics);
  return result;
}

// ─── Artist/track extraction ──────────────────────────────────────────────────

/**
 * Extract clean { artist, track } from a raw video title + channel author.
 * Handles YouTube, LB Home, Bollywood colon format, and pipe-separated titles.
 */
// ── Indian/Bollywood title parsing helpers ────────────────────────────────────
//
// Indian YouTube titles follow patterns like:
//   "Song - Movie | Actor | Singer | Label"      (label channel)
//   "Song - Singer | Movie | Year"               (old songs, label channel)
//   "Song | Movie | Singer | extra"              (no hyphen, label channel)
//   "Song - Artist"                              (personal / artist channel)
//
// The singer is almost never before the first hyphen on a label channel —
// that slot is usually the movie/album name. We detect known singers by
// keyword list and fall back gracefully when no match is found.

const EXTRACT_GARBAGE = new Set([
  "full song", "full video", "full audio", "lyric video", "lyrics video", "lyrics",
  "official video", "official audio", "audio song", "video song", "title track",
  "theme song", "hd video", "4k video", "jukebox", "audio jukebox", "video jukebox",
  "new song", "latest song", "sad song", "romantic song",
  "best ever", "best quality", "complete", "original recording", "complete original recording",
  "hd quality", "remastered", "re-mastered", "original version", "classic hit",
  "urdu lyrics", "hindi lyrics", "punjabi lyrics", "with lyrics",
]);

const LABEL_CHANNEL_KEYWORDS = [
  "t-series", "sony music", "zee music", "tips ", "shemaroo", "viacom",
  "excel music", "eros ", "saregama", "speed records", "aditya music",
  "lahari", "rajshri", "juke dock", "ultra movie", "venus movies",
  "yash raj", "dharma", "eros now", "color", "balaji", "goldmines",
  "set india", "star music", "sun music", "think music", "divo music",
  "music india", "records", " films", " movies", " entertainment",
  // Compilation/upload channels that are NOT the real artist
  "tour & tourism", "world tour", "hit songs", "old songs", "golden songs",
  "bollywood songs", "classic songs", "evergreen songs", "music hub",
  "music collection", "music station", "music zone", "music world",
  "song collection", "melodies", "qawwali collection", "sufi music",
  "top songs", "best songs", "all songs", "super hits", "mega hits",
  "desi music", "pakistan music", "india music", "hindi music",
  "nonstop", "non-stop", "jhankar", "devotional", "bhakti",
];

// Well-known Indian/Pakistani/global singer name fragments — used to identify
// which pipe segment contains the actual vocalist.
const SINGER_FRAGMENTS = [
  // Qawwali / Pakistani
  "nusrat fateh ali khan", "nusrat fateh", "rahat fateh ali khan", "rahat fateh",
  "ghulam ali", "mehdi hassan", "abida parveen", "farida khanum",
  "noor jehan", "madam noor jehan", "iqbal bano", "malika pukhraj",
  "asrar shah", "sabri brothers", "aziz mian",
  // Bollywood classical era
  "lata mangeshkar", "lata ", "asha bhosle", "asha ",
  "kishore kumar", "kishore", "mohammed rafi", "md. rafi", "md rafi",
  "mukesh", "talat mahmood", "hemant kumar", "manna dey",
  "geeta dutt", "shamshad begum", "surraiya", "zohrabai",
  // Modern Bollywood
  "arijit singh", "arijit", "sonu nigam", "shreya ghoshal",
  "udit narayan", "alka yagnik", "kumar sanu", "kavita krishnamurthy",
  "anuradha paudwal", "sp balasubrahmanyam", "s.p. balu", "s p b",
  "k.j. yesudas", "kj yesudas", "hariharan", "k s chithra", "ks chithra",
  "shankar mahadevan", "shaan", "kk ", "k.k.", "sunidhi chauhan",
  "sukhwinder singh", "sukhwinder", "jubin nautiyal", "armaan malik",
  "neha kakkar", "vishal shekhar", "a.r. rahman", "ar rahman",
  "pritam", "udit narayan",
  // South Indian
  "s. p. b", "yesudas", "chithra", "chitra",
  // Pakistani pop
  "atif aslam", "ali zafar", "strings", "junoon", "vital signs",
  "nazia hassan", "alamgir", "sajjad ali",
  // Punjabi
  "diljit dosanjh", "guru randhawa", "hardy sandhu", "b praak",
  "yo yo honey singh", "badshah", "jasmine sandlas",
  // Global
  "udit narayan",
];

function isExtractGarbage(s: string): boolean {
  const l = s.toLowerCase().trim();
  return EXTRACT_GARBAGE.has(l) || /^\d{3,4}$/.test(l) || l.length < 2;
}

function isLabelChannel(channelName: string): boolean {
  const l = channelName.toLowerCase();
  return LABEL_CHANNEL_KEYWORDS.some((k) => l.includes(k));
}

/** Returns true if the extracted result looks wrong (channel name leaked through, title has pipes, etc.) */
export function extractedResultIsSuspicious(
  result: { artist: string; track: string },
  rawTitle: string,
  channelAuthor: string,
): boolean {
  const a = result.artist.toLowerCase().trim();
  const ch = channelAuthor.toLowerCase().trim();
  // artist == channel name unchanged → parser failed
  if (a === ch) return true;
  // track still contains | → normalization didn't fire
  if (result.track.includes("|")) return true;
  // artist is a label/compilation channel keyword
  if (isLabelChannel(result.artist)) return true;
  // artist is very long (>40 chars) — probably a song title leaked
  if (result.artist.length > 45) return true;
  return false;
}

function looksLikeSinger(s: string): boolean {
  const l = s.toLowerCase();
  return SINGER_FRAGMENTS.some((k) => l.includes(k));
}

/** Strip common honorifics / prefixes from artist names for cleaner Last.fm lookup */
function stripHonorifics(name: string): string {
  return name
    .replace(/^(ustad|ustaz|late|the late|pandit|pt\.?|dr\.?|sri|shri)\s+/i, "")
    .trim();
}

function cleanChannelName(author: string): string {
  return (author || "")
    .replace(/\s*-\s*Topic\s*$/i, "")
    .replace(/\s*VEVO\s*$/i, "")
    .replace(/\s*Official\s*$/i, "")
    .replace(/\s*Music\s*$/i, "")
    .trim();
}

export function extractArtistTrack(
  rawTitle: string,
  author: string,
): { artist: string; track: string } {
  // ── Normalize: strip noise from parens/brackets ───────────────────────
  const title = rawTitle
    .replace(/\s*[\(\[【][^\)\]】]*(official|music video|lyric[s]?|lyrics video|mv|m\/v|audio|visualizer|hd|4k|full video|full song|audio song)[^\)\]】]*[\)\]】]/gi, "")
    .replace(/\s*(official\s*)?(music\s*)?(video|audio|lyric[s]?\s*video|mv|m\/v)\s*$/gi, "")
    .replace(/\s*\((\d{4})\)\s*$/g, "")
    // Normalize ALL pipe variants → " | " (handles |, | , no-space pipes)
    .replace(/\s*\|\s*/g, " | ")
    // Strip trailing pipe
    .replace(/\s*\|\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  const cleanAuthor = cleanChannelName(author);
  const isLabel = isLabelChannel(cleanAuthor);

  // ── Priority 0: "Artist - Topic" / VEVO channels — channel IS the artist ─
  // e.g. channel="Arijit Singh - Topic", cleaned → "Arijit Singh"
  // If title has no separator at all, just return cleanAuthor as artist.
  const isTopicChannel = /\s*-\s*Topic\s*$/i.test(author) || /\s*VEVO\s*$/i.test(author);
  if (isTopicChannel && cleanAuthor && !isLabel) {
    // Title might be "Artist - Song" or just "Song"
    const dashIdx = title.indexOf(" - ");
    if (dashIdx > 0) {
      const leftD = title.slice(0, dashIdx).trim();
      const rightD = title.slice(dashIdx + 3).trim();
      // If left matches channel author, it's "Artist - Song" format
      if (leftD.toLowerCase().includes(cleanAuthor.toLowerCase().split(" ")[0].toLowerCase())) {
        return { artist: cleanAuthor, track: rightD || title };
      }
      return { artist: cleanAuthor, track: title };
    }
    return { artist: cleanAuthor, track: title };
  }

  // ── Priority 1: Em-dash / en-dash (LB Home format "Track — Artist") ──
  for (const sep of [" — ", " – "]) {
    const idx = title.indexOf(sep);
    if (idx > 0) {
      const left  = title.slice(0, idx).trim();
      const right = title.slice(idx + sep.length).trim();
      if (left && right) {
        if (right.includes(" | ")) {
          const artistFromRight = right.slice(0, right.indexOf(" | ")).trim();
          return { artist: stripHonorifics(artistFromRight || right), track: left };
        }
        const rightIsArtist = right.length < 50 && !/ — | – /.test(right);
        return rightIsArtist
          ? { artist: stripHonorifics(right), track: left }
          : { artist: stripHonorifics(left), track: right };
      }
    }
  }

  // ── Split on pipes ────────────────────────────────────────────────────
  const pipeParts = title.split(" | ").map((s) => s.trim()).filter(Boolean);

  // ── Priority 2: Hyphen WITHIN the first pipe segment ─────────────────
  // Covers patterns like:
  //   "Song - Singer | Movie"                (Singer right of hyphen)
  //   "Song - Movie | Singer"                (Singer in later pipe)
  //   "Song Title - Singer"                  (no pipes at all)
  //   "Title Song - Singer | Movie Title"    (singer embedded before pipe)
  const firstSeg = pipeParts[0] || title;
  const hIdx = firstSeg.indexOf(" - ");

  if (hIdx > 0) {
    const leftH  = firstSeg.slice(0, hIdx).trim();
    const rightH = firstSeg.slice(hIdx + 3).trim();

    if (leftH && rightH) {
      // Case A: right of hyphen is known garbage → find singer in pipes
      if (isExtractGarbage(rightH)) {
        const singerPart = pipeParts.slice(1).find(
          (p) => looksLikeSinger(p) && !isExtractGarbage(p),
        );
        const fallbackPipe = pipeParts.slice(1).find((p) => !isExtractGarbage(p));
        return {
          artist: stripHonorifics(singerPart ?? fallbackPipe ?? (cleanAuthor || "Unknown")),
          track: leftH,
        };
      }

      // Case B: right of hyphen IS a known singer → "Song - Singer" format
      if (looksLikeSinger(rightH)) {
        return { artist: stripHonorifics(rightH), track: leftH };
      }

      // Case C: label channel — right of hyphen is movie/album name
      // Look for a KNOWN SINGER in ALL pipe parts (including later ones)
      // Prefer the LAST known singer found (e.g. "Song - Movie | Composer | Singer")
      if (isLabel || pipeParts.length > 1) {
        // Check ALL segments (including rightH itself) for known singers
        const allSegs = [rightH, ...pipeParts.slice(1)].filter((p) => !isExtractGarbage(p));
        // Last-wins: in Indian format the vocalist is usually the last named person
        const singers = allSegs.filter((p) => looksLikeSinger(p));
        if (singers.length > 0) {
          return { artist: stripHonorifics(singers[singers.length - 1]), track: leftH };
        }
        // No known singer found — rightH is probably the movie. Use first non-garbage pipe.
        const fallbackPipe = pipeParts.slice(1).find((p) => !isExtractGarbage(p));
        if (isLabel) {
          return { artist: stripHonorifics(fallbackPipe ?? rightH), track: leftH };
        }
      }

      // Case D: Personal / artist channel, Western or Indian format
      // Heuristic: if channel name matches the LEFT side → Western "Artist - Song"
      // Otherwise if right is short (≤4 words) → Indian "Song - Artist"
      const rightWordCount = rightH.split(" ").length;
      const leftMatchesChannel = cleanAuthor &&
        leftH.toLowerCase().includes(cleanAuthor.toLowerCase().split(" ")[0].toLowerCase());
      if (leftMatchesChannel && !isLabel) {
        // Western "Artist - Song": channel = artist, right = song title
        return { artist: stripHonorifics(leftH), track: rightH };
      }
      if (rightWordCount <= 4 && !isLabel) {
        // Could be "Song - Artist" (Indian personal) OR "Artist - Song" (Western)
        // If left is longer than right, left is probably the song
        return leftH.length >= rightH.length
          ? { artist: stripHonorifics(rightH), track: leftH }   // "Song - Artist"
          : { artist: stripHonorifics(leftH), track: rightH };  // "Artist - Song"
      }

      return { artist: stripHonorifics(leftH), track: rightH };
    }
  }

  // ── Priority 3: Pure pipe format "Track | Segment | Singer | ..." ────
  if (pipeParts.length >= 2) {
    const trackPart  = pipeParts[0];
    const nonGarbage = pipeParts.slice(1).filter((p) => !isExtractGarbage(p));

    if (nonGarbage.length > 0) {
      // Prefer last known singer in the list
      // (Indian title order: Song | Movie | Composer | Singer)
      const singers = nonGarbage.filter((p) => looksLikeSinger(p));
      if (singers.length > 0) {
        return { artist: stripHonorifics(singers[singers.length - 1]), track: trackPart };
      }
      // No known singer — take last non-garbage segment (usually most specific)
      const lastPart  = nonGarbage[nonGarbage.length - 1];
      const firstPart = nonGarbage[0];
      const useLast   = lastPart.length < 40 && !/\d{4}/.test(lastPart);
      return { artist: stripHonorifics(useLast ? lastPart : firstPart), track: trackPart };
    }
  }

  // ── Priority 4: Singer embedded in title without any separator ────────
  // e.g. "Dam Mast Qalandar Nusrat Fateh Ali Khan" (after bracket removal)
  {
    const titleLower = title.toLowerCase();
    // Sort by fragment length descending so longer (more specific) names match first
    const sortedFrags = [...SINGER_FRAGMENTS].sort((a, b) => b.length - a.length);
    const found = sortedFrags.find((frag) => {
      const idx = titleLower.indexOf(frag);
      return idx > 5; // singer not at the very start
    });
    if (found) {
      const idx       = titleLower.indexOf(found);
      const trackPart = title.slice(0, idx).replace(/[\s\-|,]+$/, "").trim();
      const singerPart = title.slice(idx, idx + found.length).trim();
      const cleanedSinger = stripHonorifics(singerPart);
      if (trackPart && cleanedSinger) {
        return { artist: cleanedSinger, track: trackPart };
      }
    }
  }

  // ── Final fallback ────────────────────────────────────────────────────
  const fallbackArtist = isLabel ? "Unknown" : (cleanAuthor || "Unknown");
  return { artist: fallbackArtist, track: title || "Unknown" };
}

// ─── Source 1: LRCLIB ─────────────────────────────────────────────────────────

async function fromLrclib(
  trackName: string,
  artistName: string,
  duration?: number,
): Promise<LyricsResult | null> {
  try {
    const params = new URLSearchParams({ track_name: trackName, artist_name: artistName });
    if (duration) params.set("duration", String(Math.round(duration)));
    const res = await fetch(`${LRCLIB_API}/get?${params.toString()}`, {
      headers: { "Lrclib-Client": "Elysium Music Player" },
    });
    if (!res.ok) return null;
    return attachLines({ ...(await res.json()), source: "lrclib" });
  } catch { return null; }
}

async function searchLrclib(
  trackName: string,
  artistName: string,
): Promise<LyricsResult | null> {
  try {
    // Try artist+track, then track-only (helps when artist romanisation varies)
    for (const q of [`${artistName} ${trackName}`, trackName]) {
      const res = await fetch(`${LRCLIB_API}/search?${new URLSearchParams({ q })}`, {
        headers: { "Lrclib-Client": "Elysium Music Player" },
      });
      if (!res.ok) continue;
      const results: LyricsResult[] = await res.json();
      if (!results.length) continue;
      const withSynced = results.filter(r => r.syncedLyrics);
      const pool = withSynced.length ? withSynced : results;
      const best =
        pool.find(r => r.trackName.toLowerCase().includes(trackName.toLowerCase())) ?? pool[0];
      return attachLines({ ...best, source: "lrclib-search" });
    }
    return null;
  } catch { return null; }
}

// ─── Source 2: NetEase Cloud Music (via server proxy) ─────────────────────────
// Direct browser requests to music.163.com are blocked by CORS.
// We proxy through Elysium's own server at /api/lyrics-proxy/netease/*.

async function fromNetease(
  trackName: string,
  artistName: string,
): Promise<LyricsResult | null> {
  try {
    // Step 1: search
    const searchRes = await fetch(
      `/api/lyrics-proxy/netease/search?s=${encodeURIComponent(`${artistName} ${trackName}`)}&limit=5`,
    );
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const songs: any[] = searchData?.result?.songs ?? [];
    if (!songs.length) return null;

    const best =
      songs.find(s => s.name?.toLowerCase().includes(trackName.toLowerCase())) ?? songs[0];

    // Step 2: fetch lyrics
    const lyricsRes = await fetch(`/api/lyrics-proxy/netease/lyric?id=${best.id}`);
    if (!lyricsRes.ok) return null;
    const lyricsData = await lyricsRes.json();

    const syncedLrc: string | null = lyricsData?.lrc?.lyric ?? null;
    const plainLrc:  string | null = lyricsData?.klyric?.lyric ?? null;
    if (!syncedLrc && !plainLrc) return null;

    return attachLines({
      id: best.id,
      trackName: best.name ?? trackName,
      artistName: best.artists?.map((a: any) => a.name).join(", ") ?? artistName,
      albumName: best.album?.name ?? "",
      duration: Math.round((best.duration ?? 0) / 1000),
      instrumental: false,
      plainLyrics: plainLrc,
      syncedLyrics: syncedLrc,
      source: "netease",
    });
  } catch { return null; }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Fetch lyrics from multiple sources, preferring synced over plain.
 * LRCLIB + NetEase run in parallel; LRCLIB search is a last-resort fallback.
 */
export async function getLyrics(
  trackName: string,
  artistName: string,
  albumName?: string,
  duration?: number,
): Promise<LyricsResult | null> {
  if (!trackName || trackName === "Unknown") return null;

  const [lrclibResult, neteaseResult] = await Promise.all([
    fromLrclib(trackName, artistName, duration),
    fromNetease(trackName, artistName),
  ]);

  const candidates = [lrclibResult, neteaseResult].filter(Boolean) as LyricsResult[];
  const withSynced = candidates.filter(r => (r.lines?.length ?? 0) > 0);

  if (withSynced.length) {
    // Prefer LRCLIB synced (better timing accuracy); else NetEase
    return withSynced.find(r => r.source === "lrclib") ?? withSynced[0];
  }
  if (candidates.length) return candidates[0];

  return await searchLrclib(trackName, artistName);
}

/**
 * Get the current lyric line index based on playback time.
 */
export function getCurrentLineIndex(lines: LyricLine[], currentTime: number): number {
  if (!lines.length) return -1;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= currentTime) idx = i;
    else break;
  }
  return idx;
}
