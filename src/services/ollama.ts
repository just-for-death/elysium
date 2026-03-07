import { log } from "../utils/logger";

export interface OllamaSuggestion {
  title: string;
  artist: string;
  reason: string;
}

export interface OllamaRichContext {
  /** ListenBrainz top tracks for the period */
  topTracks?: Array<{ title: string; artist: string; listenCount?: number }>;
  /** ListenBrainz top artists for the period — reveals genre/taste signature */
  topArtists?: Array<{ artist: string; listenCount?: number }>;
  /** ListenBrainz most recent listens (last 20) — what the user was just listening to */
  recentListens?: Array<{ title: string; artist: string }>;
  /** ListenBrainz CF recommendations */
  recommendations?: Array<{ title: string; artist: string }>;
  /** Apple Music / iTunes chart tracks */
  appleCharts?: Array<{ title: string; artist: string }>;
}

/**
 * GTX 1650 (4 GB VRAM) tuned parameters.
 *
 * - num_gpu: 33  → keeps the model on GPU (llama3.2:3b / qwen2.5:3b fit in 4 GB)
 * - num_thread: 4 → leaves 4 CPU threads for the browser
 * - num_ctx: 768  → enough for expanded prompt (~700 tokens) without stressing 4GB VRAM
 * - num_predict: 100 → we only need ~60 tokens for the JSON reply
 * - temperature: 0.65 → slightly lower for more deterministic JSON output
 * - repeat_penalty: 1.1 → discourages repeating the avoid-list
 * - top_p: 0.85 → nucleus sampling keeps variety while being fast
 *
 * These settings allow llama3.2:3b to generate in ~0.4–1.5 s on a GTX 1650.
 */
const GPU_FAST_OPTIONS = {
  num_gpu: 33,
  num_thread: 4,
  num_ctx: 768,
  num_predict: 100,
  temperature: 0.65,
  repeat_penalty: 1.1,
  top_p: 0.85,
};

/**
 * Ask an Ollama LLM for the ideal next song given rich listening context.
 *
 * Now feeds Ollama:
 *  - Current track
 *  - Recently played / already-queued avoid list
 *  - User's ListenBrainz top tracks (when available)
 *  - ListenBrainz CF recommendations (when available)
 *  - Apple Music chart tracks (when available)
 *
 * Returns null on any failure — the caller treats this as "no suggestion".
 */
export const getOllamaQueueSuggestion = async (
  ollamaUrl: string,
  model: string,
  currentSong: { title: string; artist: string },
  avoidList: Array<{ title: string }>,
  richContext?: OllamaRichContext,
): Promise<OllamaSuggestion | null> => {
  const avoidLines = avoidList
    .slice(0, 12)
    .map((h, i) => `${i + 1}. "${h.title}"`)
    .join("\n");

  // Build optional context sections
  const contextSections: string[] = [];

  if (richContext?.topArtists?.length) {
    const lines = richContext.topArtists
      .slice(0, 8)
      .map((a) => `  - ${a.artist}${a.listenCount ? ` (${a.listenCount} plays)` : ""}`)
      .join("\n");
    contextSections.push(`User's most-listened artists this month (ListenBrainz):\n${lines}`);
  }

  if (richContext?.topTracks?.length) {
    const lines = richContext.topTracks
      .slice(0, 8)
      .map((t) => `  - "${t.title}" by ${t.artist}${t.listenCount ? ` (${t.listenCount} plays)` : ""}`)
      .join("\n");
    contextSections.push(`User's most-played tracks this month (ListenBrainz):\n${lines}`);
  }

  if (richContext?.recentListens?.length) {
    const lines = richContext.recentListens
      .slice(0, 10)
      .map((t) => `  - "${t.title}" by ${t.artist}`)
      .join("\n");
    contextSections.push(`User's most recent listens (what they were just playing — ListenBrainz):\n${lines}`);
  }

  if (richContext?.recommendations?.length) {
    const lines = richContext.recommendations
      .slice(0, 6)
      .map((t) => `  - "${t.title}" by ${t.artist}`)
      .join("\n");
    contextSections.push(`Personalised recommendations for this user (ListenBrainz CF):\n${lines}`);
  }

  if (richContext?.appleCharts?.length) {
    const lines = richContext.appleCharts
      .slice(0, 6)
      .map((t) => `  - "${t.title}" by ${t.artist}`)
      .join("\n");
    contextSections.push(`Currently trending on Apple Music charts:\n${lines}`);
  }

  const contextBlock = contextSections.length
    ? `\nUser taste profile (use this to match their listening style):\n${contextSections.join("\n\n")}\n`
    : "";

  const prompt = `You are a music curator who deeply understands a user's taste from their listening history.

Currently playing: "${currentSong.title}" by ${currentSong.artist}

Do NOT suggest any of these (recently played / already queued):
${avoidLines}
${contextBlock}
Rules:
- Study the user's taste profile above carefully — match their actual listening style, not generic suggestions
- Suggest a real, well-known song that fits BOTH the current track AND their taste profile
- Prefer artists they already love (see most-listened artists above) when they fit the current vibe
- Match the mood, genre, energy, and language of what is currently playing
- DO NOT suggest any track from the avoid list above
- Consider trending tracks only if they genuinely fit the user's taste

Respond ONLY with a JSON object — no markdown fences, no explanation:
{"title": "Song Title", "artist": "Artist Name", "reason": "one sentence why this fits their taste"}`;

  try {
    // Two attempts — first may hit Ollama cold-start (model loading on GTX 1650 can take 10-20s)
    for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: GPU_FAST_OPTIONS,
      }),
      // 30s: GTX 1650 cold-start (model load) can take up to 20s, then ~2s inference
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      log.debug("Ollama request failed", { status: res.status, attempt });
        if (attempt === 0) continue;
      return null;
    }

    const data = await res.json();
    const raw: string = data.response ?? "";
    const clean = raw.replace(/```json|```/g, "").trim();

    const start = clean.indexOf("{");
    if (start === -1) {
        if (attempt === 0) continue;
        return null;
      }

    let depth = 0;
    let end = -1;
    for (let i = start; i < clean.length; i++) {
      if (clean[i] === "{") depth++;
      else if (clean[i] === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
      if (end === -1) {
        if (attempt === 0) continue;
        return null;
      }

    const parsed = JSON.parse(clean.slice(start, end + 1));
    if (typeof parsed.title === "string" && typeof parsed.artist === "string") {
      log.debug("Ollama suggestion", { title: parsed.title, artist: parsed.artist, reason: parsed.reason });
      return parsed as OllamaSuggestion;
    }
      if (attempt === 0) continue;
    return null;
    }
    return null;
  } catch (err) {
    log.debug("Ollama queue suggestion failed", { err });
    return null;
  }
};

/**
 * Check if Ollama is reachable and return available model names.
 * Also probes GPU availability via /api/version endpoint tags.
 */
export const testOllamaConnection = async (
  ollamaUrl: string,
): Promise<{ ok: boolean; models: string[] }> => {
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, models: [] };
    const data = await res.json();
    const models: string[] = Array.isArray(data.models)
      ? data.models.map((m: any) => m.name as string)
      : [];
    return { ok: true, models };
  } catch {
    return { ok: false, models: [] };
  }
};

/**
 * Use Ollama to extract the real artist + track name from a messy YouTube title.
 * Called only when regex-based extractArtistTrack gives a suspicious result.
 *
 * Returns null on any failure (caller falls back to best-effort regex result).
 */
export const ollamaExtractArtistTrack = async (
  ollamaUrl: string,
  model: string,
  rawTitle: string,
  channelName: string,
): Promise<{ artist: string; track: string } | null> => {
  if (!ollamaUrl) return null;
  try {
    const prompt = `You are a music metadata extractor. Extract the real artist name and song name from this YouTube video.

Video title: "${rawTitle}"
YouTube channel: "${channelName}"

Rules:
- The channel is often a label/compilation (T-Series, World Tour, etc.) NOT the real artist
- For Indian/Pakistani songs: the singer is usually after the first | or at the end (e.g. "Nusrat Fateh Ali Khan")
- Strip honorifics like "Ustad", "Late", "Pt." from artist names
- Remove noise like "Best Ever", "HD", "Full Song", "Urdu Lyrics" etc.
- If title has pipes (|) the format is usually "Song | Movie/Album | Singer"
- If title has hyphen the format varies: "Song - Singer" or "Artist - Song"

Return ONLY a JSON object on a single line, nothing else:
{"artist":"<real singer name>","track":"<song title only>"}`;

    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          num_gpu: 33,
          num_thread: 4,
          num_ctx: 512,
          num_predict: 80,
          temperature: 0.1,
        },
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const raw: string = data?.response ?? "";

    // Extract JSON from response
    const match = raw.match(/\{[^}]+\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const artist = (parsed.artist ?? "").trim();
    const track  = (parsed.track  ?? "").trim();
    if (!artist || !track) return null;
    return { artist, track };
  } catch {
    return null;
  }
};
