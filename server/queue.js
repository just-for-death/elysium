"use strict";

/**
 * queue.js — AI music recommendation queue
 *
 * Changes:
 *  - Invidious instance read from db settings (invidiousInstance) — no hardcoded URL
 *  - ok-check before JSON parsing every upstream response
 *  - Uses structured logger (log) instead of console.log
 *  - Input validation on currentSong
 *  - AbortSignal.timeout() on all external fetches
 */

const express = require("express");
const db      = require("./db");

const router = express.Router();

// ── Shared structured logger (mirrors server/index.js) ───────────────────────
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_LEVEL = LEVELS[(process.env.LOG_LEVEL || "info").toLowerCase()] ?? LEVELS.info;

const log = {
  _emit(level, msg, extra = {}) {
    if (LEVELS[level] < LOG_LEVEL) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level: level.toUpperCase(), svc: "elysium", msg, ...extra });
    (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
  },
  debug: (msg, e) => log._emit("debug", msg, e),
  info:  (msg, e) => log._emit("info",  msg, e),
  warn:  (msg, e) => log._emit("warn",  msg, e),
  error: (msg, e) => log._emit("error", msg, e),
};

// ── POST /api/v1/library/recommendations/queue ────────────────────────────────
router.post("/queue", async (req, res) => {
  try {
    const { currentSong } = req.body || {};
    if (!currentSong || typeof currentSong.title !== "string" || !currentSong.title.trim()) {
      return res.status(400).json({ error: "currentSong.title is required" });
    }

    const settings = db.getSettingsRaw();
    const ollamaUrl   = (settings.ollamaUrl   || "").trim();
    const ollamaModel = (settings.ollamaModel  || "llama3.2:3b");

    if (!settings.ollamaEnabled || !ollamaUrl) {
      return res.status(400).json({ error: "Ollama is not configured on this server." });
    }

    // Invidious instance — read from settings (user-configured), no hardcoded fallback
    const invidiousBase = (settings.invidiousInstance || "").replace(/\/+$/, "");
    if (!invidiousBase) {
      return res.status(400).json({ error: "No Invidious instance configured in settings." });
    }

    // Build context from history
    const history    = db.getHistory().slice(0, 15);
    const avoidList  = history.map(h => `"${h.title}" by ${h.artist}`).join("\n- ");
    const artistsDict = {};
    history.forEach(h => { if (h.artist) artistsDict[h.artist] = (artistsDict[h.artist] || 0) + 1; });
    const topArtists = Object.entries(artistsDict)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(e => e[0])
      .join(", ");

    const prompt =
`You are an elite music streaming algorithm.
Currently playing: "${currentSong.title}" by ${currentSong.artist || "Unknown"}

User's most listened artists: ${topArtists || "none"}

Do NOT suggest any of these previously played tracks:
- ${avoidList || "none"}

Suggest exactly ONE real, highly-popular track that perfectly matches the vibe, tempo, and genre of the currently playing song. Try to cater to their top artists if applicable, but do not repeat avoiding tracks.
Answer ONLY in JSON format: {"title": "Song Name", "artist": "Artist Name", "reason": "Why this fits"}`;

    log.info("ai:queue:start", { song: currentSong.title });

    // 1. Prompt Ollama
    const ollamaRes = await fetch(`${ollamaUrl}/api/generate`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ model: ollamaModel, prompt, stream: false, options: { temperature: 0.65, num_predict: 100 } }),
      signal:  AbortSignal.timeout(40_000),
    });

    if (!ollamaRes.ok) {
      const txt = await ollamaRes.text().catch(() => "");
      log.error("ai:ollama:error", { status: ollamaRes.status, body: txt.slice(0, 200) });
      throw new Error(`Ollama returned ${ollamaRes.status}`);
    }

    const jsonText = await ollamaRes.json();
    const raw   = jsonText.response || "";
    const clean = raw.replace(/```json|```/g, "").trim();
    const start = clean.indexOf("{");
    const end   = clean.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("Ollama output invalid: " + raw.slice(0, 200));

    const parsed = JSON.parse(clean.slice(start, end + 1));
    if (!parsed.title || !parsed.artist) throw new Error("Missing title/artist in Ollama output");

    log.info("ai:queue:decided", { title: parsed.title, artist: parsed.artist });

    // 2. Resolve via user-configured Invidious instance
    const searchQuery = encodeURIComponent(`${parsed.artist} ${parsed.title} audio`);
    const searchRes   = await fetch(`${invidiousBase}/api/v1/search?q=${searchQuery}&type=video`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!searchRes.ok) {
      const txt = await searchRes.text().catch(() => "");
      log.error("ai:invidious:search:error", { status: searchRes.status, body: txt.slice(0, 200) });
      throw new Error(`Invidious search returned ${searchRes.status}`);
    }

    const searchData = await searchRes.json();
    if (!searchData || !searchData.length) throw new Error("No YouTube tracks found for suggestion.");

    const videoId  = searchData[0].videoId;
    const videoRes = await fetch(`${invidiousBase}/api/v1/videos/${videoId}`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!videoRes.ok) {
      const txt = await videoRes.text().catch(() => "");
      log.error("ai:invidious:video:error", { status: videoRes.status, body: txt.slice(0, 200) });
      throw new Error(`Invidious video lookup returned ${videoRes.status}`);
    }

    const videoData = await videoRes.json();

    let streamUrl = null;
    if (videoData.adaptiveFormats) {
      const audioStreams = videoData.adaptiveFormats.filter(f => f.type && f.type.includes("audio/"));
      if (audioStreams.length > 0) streamUrl = audioStreams[0].url;
    }

    if (!streamUrl) throw new Error("No audio stream found on YouTube video.");

    // Validate stream URL scheme — no file:// or other dangerous protocols
    if (!/^https?:\/\//i.test(streamUrl)) throw new Error("Unsafe stream URL scheme returned by Invidious.");

    log.info("ai:queue:resolved", { videoId, title: parsed.title });

    res.json({
      ok: true,
      track: {
        id:      videoId,
        title:   parsed.title,
        artist:  parsed.artist,
        url:     streamUrl,
        artwork: videoData.videoThumbnails
          ? videoData.videoThumbnails.find(t => t.quality === "high")?.url ?? null
          : null,
        reason: parsed.reason,
      },
    });

  } catch (err) {
    log.error("ai:queue:error", { err: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
