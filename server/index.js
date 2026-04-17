/**
 * Elysium – production server  (v2)
 *
 * Features:
 *  - SPA fallback (all unknown routes → index.html)
 *  - Brotli → Gzip → identity content encoding negotiation
 *  - Aggressive caching for hashed assets, no-cache for index.html
 *  - Security headers (CSP, HSTS, X-Frame-Options, …)
 *  - Push notification relay endpoint (auth-protected broadcast)
 *  - /health endpoint for Docker health-checks
 *  - Graceful shutdown on SIGTERM
 *  - Proxy of /api/live/* → sync-server (WebSocket + REST)
 *  - Structured JSON logging for easy diagnosis
 *
 * Log format: {"ts":"ISO","level":"INFO","svc":"elysium","msg":"...","...extra"}
 * Enable debug:  LOG_LEVEL=debug  (env)
 */

"use strict";

const path        = require("path");
const fs          = require("fs");
const http        = require("http");
const express     = require("express");
const compression = require("compression");
const rateLimit   = require("express-rate-limit");
const webpush     = require("web-push");
const dns         = require("dns");

// Fix IPv6 fetch timeouts in Docker environments
dns.setDefaultResultOrder('ipv4first');



// ── Structured logger ─────────────────────────────────────────────────────────

const { createLogger } = require("./logger");
const log = createLogger("elysium");

// ── Config ────────────────────────────────────────────────────────────────────

const PORT             = process.env.PORT || 3000;
const BUILD_DIR        = path.join(__dirname, "../build");
const SYNC_SERVER_URL  = process.env.SYNC_SERVER_URL || "http://localhost:3001";
const SYNC_SERVER_HOST = (() => { try { return new URL(SYNC_SERVER_URL).host; } catch { return "localhost:3001"; } })();

const VAPID_PUBLIC     = process.env.VAPID_PUBLIC_KEY  || "";
const VAPID_PRIVATE    = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_EMAIL      = process.env.VAPID_EMAIL       || "mailto:elysium@example.com";
const BROADCAST_SECRET = process.env.BROADCAST_SECRET  || "";

// CORS configuration: comma-separated list of allowed origins, or "*" for all
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*").split(",").map(s => s.trim());

const LOG_LEVEL_NAME = (process.env.LOG_LEVEL || "info").toLowerCase();

// ── Web Push ──────────────────────────────────────────────────────────────────

let pushEnabled = false;
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
  pushEnabled = true;
  log.info("push:enabled");
}
const subscriptions = new Map();

// ── Middleware ─────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: "10mb" }));

// Request logger (access log, debug only)
app.use((req, _res, next) => {
  log.debug("request", { method: req.method, path: req.path, ip: req.ip });
  next();
});

// ── Rate Limiting ─────────────────────────────────────────────────────────────

// Standard limit for proxy/API endpoints
const defaultLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — slow down" },
});

// Tight limit for the expensive AI queue endpoint (calls Ollama + 2× Invidious)
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "AI queue rate limit exceeded — wait 1 minute" },
});

// Apply rate limiting to all API and push routes (two calls — more reliable than array form)
app.use("/api", defaultLimiter);
app.use("/push", defaultLimiter);

// ── Optional API Authentication ───────────────────────────────────────────────
//
// Set API_SECRET env var to require `Authorization: Bearer <secret>` on all
// /api/v1/library/* and /api/v1/scrobble requests.
// Leave unset for open (LAN-only) deployments.

const API_SECRET = process.env.API_SECRET || "";

function requireApiKey(req, res, next) {
  if (!API_SECRET) return next(); // not configured — allow all
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== API_SECRET) {
    return res.status(401).json({ error: "Unauthorized — API_SECRET required" });
  }
  next();
}

app.use(
  compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) return false;
      return compression.filter(req, res);
    },
  })
);

app.use((req, res, next) => {
  // Dynamic CORS: respect ALLOWED_ORIGINS env var (comma-separated, or "*" for all)
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes("*") || (origin && ALLOWED_ORIGINS.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-no-compression");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  res.setHeader("X-Frame-Options",        "SAMEORIGIN");
  res.setHeader("X-XSS-Protection",       "1; mode=block");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy",        "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy",     "autoplay=(self), camera=(), microphone=(), geolocation=()");
  if (process.env.ENABLE_HSTS === "true") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  next();
});

// ── Static assets ──────────────────────────────────────────────────────────────

app.use(
  express.static(BUILD_DIR, {
    index: false,
    setHeaders(res, filePath) {
      const name = path.basename(filePath);
      if (name === "service-worker.js" || name === "service-worker.js.map") {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.setHeader("Pragma",        "no-cache");
      } else if (name.match(/\.[0-9a-f]{8,}\.(js|css|png|jpg|webp|svg|woff2?)$/)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else if (name.match(/\.(png|ico|svg|webmanifest|json)$/)) {
        res.setHeader("Cache-Control", "public, max-age=86400");
      }
    },
  })
);


// ── Health ─────────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), push: pushEnabled });
});

// ── Central Database API (Suwayomi Architecture) ───────────────────────────────

const db = require("./db");
const apiRouter = express.Router();

apiRouter.get("/settings", (req, res) => res.json(db.getSettings()));
apiRouter.put("/settings", (req, res) => res.json(db.updateSettings(req.body)));

apiRouter.get("/history", (req, res) => res.json(db.getHistory()));
apiRouter.post("/history", (req, res) => res.json(db.addHistory(req.body)));
apiRouter.get("/history/:id", (req, res) => {
  const item = db.getHistoryById(req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
});
apiRouter.put("/history/:id", (req, res) => {
  const item = db.updateHistory(req.params.id, req.body);
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
});
apiRouter.delete("/history/:id", (req, res) => { db.deleteHistory(req.params.id); res.json({ok:true}); });
apiRouter.delete("/history", (req, res) => { db.clearHistory(); res.json({ok:true}); });

apiRouter.get("/playlists", (req, res) => res.json(db.getPlaylists()));
apiRouter.post("/playlists", (req, res) => res.json(db.addPlaylist(req.body)));
apiRouter.get("/playlists/:id", (req, res) => {
  const item = db.getPlaylist(req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
});
apiRouter.put("/playlists/:id", (req, res) => res.json(db.updatePlaylist(req.params.id, req.body)));
apiRouter.delete("/playlists/:id", (req, res) => { db.deletePlaylist(req.params.id); res.json({ok:true}); });

apiRouter.get("/artists", (req, res) => res.json(db.getArtists()));
apiRouter.post("/artists", (req, res) => res.json(db.addArtist(req.body)));
apiRouter.get("/artists/:id", (req, res) => {
  const item = db.getArtist(req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
});
apiRouter.put("/artists/:id", (req, res) => {
  const item = db.updateArtist(req.params.id, req.body);
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
});
apiRouter.delete("/artists/:id", (req, res) => { db.deleteArtist(req.params.id); res.json({ok:true}); });
apiRouter.delete("/artists", (req, res) => { db.clearArtists(); res.json({ok:true}); });

apiRouter.get("/favorites", (req, res) => res.json(db.getFavorites()));
apiRouter.post("/favorites", (req, res) => res.json(db.addFavorite(req.body)));
apiRouter.delete("/favorites/:id", (req, res) => { db.deleteFavorite(req.params.id); res.json({ok:true}); });

apiRouter.get("/albums", (req, res) => res.json(db.getAlbums()));
apiRouter.post("/albums", (req, res) => res.json(db.addAlbum(req.body)));
apiRouter.get("/albums/:id", (req, res) => {
  const item = db.getAlbum(req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
});
apiRouter.put("/albums/:id", (req, res) => {
  const item = db.updateAlbum(req.params.id, req.body);
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
});
apiRouter.delete("/albums/:id", (req, res) => { db.deleteAlbum(req.params.id); res.json({ok:true}); });
apiRouter.delete("/albums", (req, res) => { db.clearAlbums(); res.json({ok:true}); });

apiRouter.use("/recommendations", aiLimiter, require("./queue"));

// ── Service Proxies (Protected) ───────────────────────────────────────────

// iTunes
apiRouter.get("/itunes/search", async (req, res) => {
  const { term, media, entity, limit, lang } = req.query;
  if (!term) return res.status(400).json({ error: "Missing term" });
  try {
    const params = new URLSearchParams({ term, ...(media && {media}), ...(entity && {entity}), ...(limit && {limit}), ...(lang && {lang}) });
    const data = await safeFetchJson(`https://itunes.apple.com/search?${params}`);
    res.setHeader("Cache-Control", "public, max-age=3600").json(data);
  } catch (err) { res.status(err.message === "429" ? 429 : 502).json({ error: "iTunes search proxy failed", detail: err.message }); }
});

apiRouter.get("/itunes/lookup", async (req, res) => {
  const { id, entity, limit, sort } = req.query;
  if (!id) return res.status(400).json({ error: "Missing id" });
  try {
    const params = new URLSearchParams({ id, ...(entity && {entity}), ...(limit && {limit}), ...(sort && {sort}) });
    const data = await safeFetchJson(`https://itunes.apple.com/lookup?${params}`);
    res.setHeader("Cache-Control", "public, max-age=3600").json(data);
  } catch (err) { res.status(502).json({ error: "iTunes lookup failed", detail: err.message }); }
});

apiRouter.get("/itunes/rss/:cc/:chart", async (req, res) => {
  const { cc, chart } = req.params;
  const limit = parseInt(req.query.limit) || 50;
  const allowed = ["topsongs", "topalbums", "topmusic", "newmusic", "recentreleases"];
  if (!allowed.includes(chart)) return res.status(400).json({ error: "Invalid chart" });
  try {
    const data = await safeFetchJson(`https://itunes.apple.com/${encodeURIComponent(cc)}/rss/${encodeURIComponent(chart)}/limit=${limit}/json`);
    res.setHeader("Cache-Control", "public, max-age=1800").json(data);
  } catch (err) { res.status(502).json({ error: "iTunes RSS failed", detail: err.message }); }
});

// NetEase
apiRouter.get("/netease/search", async (req, res) => {
  const { s, limit } = req.query;
  if (!s) return res.status(400).json({ error: "Missing query" });
  try {
    const upstream = await safeRequest(`https://music.163.com/api/search/get?s=${encodeURIComponent(s)}&type=1&limit=${limit || 5}`, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com/" },
      timeout: 10000,
    });
    if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
    res.setHeader("Cache-Control", "public, max-age=3600").json(await upstream.json());
  } catch (err) { res.status(502).json({ error: "NetEase search failed", detail: err.message }); }
});

apiRouter.get("/netease/lyric", async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Missing id" });
  try {
    const upstream = await safeRequest(`https://music.163.com/api/song/lyric?id=${id}&lv=1&kv=1&tv=-1`, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com/" },
      timeout: 10000,
    });
    if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
    res.setHeader("Cache-Control", "public, max-age=3600").json(await upstream.json());
  } catch (err) { res.status(502).json({ error: "NetEase lyrics failed", detail: err.message }); }
});

// ── Invidious proxy endpoints ──────────────────────────────────────────────
// All Invidious API calls are handled by direct app routes (defined later).
// Router-based Invidious endpoints were removed to avoid duplicate definitions.

// ListenBrainz
apiRouter.get("/listenbrainz/playlists", async (req, res) => {
  const token = db.getSettingsRaw().listenBrainzToken;
  const user  = db.getSettingsRaw().listenBrainzUsername;
  if (!token || !user) return res.status(400).json({ error: "ListenBrainz not configured" });
  try {
    const upstream = await safeRequest(`https://api.listenbrainz.org/1/user/${encodeURIComponent(user)}/playlists`, {
      headers: { "Authorization": `Token ${token}` }
    });
    const data = await upstream.json();
    if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
    res.json(data.playlists || []);
  } catch (err) {
    res.status(502).json({ error: "ListenBrainz playlist fetch failed", detail: err.message });
  }
});

apiRouter.post("/listenbrainz/sync-playlist/:id", async (req, res) => {
  const token = db.getSettingsRaw().listenBrainzToken;
  if (!token) return res.status(400).json({ error: "ListenBrainz token not configured" });

  const { id } = req.params;
  const local = db.getPlaylist(id);
  if (!local) return res.status(404).json({ error: "Local playlist not found" });

  try {
    const upstream = await safeRequest("https://api.listenbrainz.org/1/playlist/create", {
      method: "POST",
      headers: { "Authorization": `Token ${token}`, "Content-Type": "application/json" },
      body: {
        playlist: {
          extension: { "https://listenbrainz.org/public": { public: true } },
          title: local.title,
          track: local.videos.map(v => ({
            identifier: v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : undefined,
            title: v.title,
            creator: v.artist,
          }))
        }
      }
    });
    const data = await upstream.json();
    if (!upstream.ok) throw new Error(data.error || `HTTP ${upstream.status}`);
    res.json({ ok: true, playlist_mbid: data.playlist_mbid });
  } catch (err) {
    res.status(502).json({ error: "ListenBrainz sync failed", detail: err.message });
  }
});

apiRouter.get("/listenbrainz/playlist/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const upstream = await safeRequest(`https://api.listenbrainz.org/1/playlist/${id}`);
    const data = await upstream.json();
    if (!upstream.ok) throw new Error(data.error || `LB HTTP ${upstream.status}`);
    const playlist = {
      id: data.playlist.identifier || id,
      title: data.playlist.title || "LB Playlist",
      videos: (data.playlist.track || []).map(t => ({
        id: t.identifier?.split("v=")[1] || t.title,
        videoId: t.identifier?.split("v=")[1] || null,
        title: t.title,
        artist: t.creator,
      }))
    };
    res.json(playlist);
  } catch (err) {
    res.status(502).json({ error: "LB playlist detail fetch failed", detail: err.message });
  }
});

apiRouter.post("/listenbrainz/import-playlist/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const upstream = await safeRequest(`https://api.listenbrainz.org/1/playlist/${id}`);
    const data = await upstream.json();
    if (!upstream.ok) throw new Error(data.error || `LB HTTP ${upstream.status}`);
    const title = data.playlist.title || "Imported LB Playlist";
    const tracks = (data.playlist.track || []).map(t => ({
      id: t.identifier?.split("v=")[1] || t.title,
      videoId: t.identifier?.split("v=")[1] || null,
      title: t.title,
      artist: t.creator,
    }));
    const pl = db.addPlaylist({ title, videos: tracks });
    res.json({ ok: true, playlist: pl });
  } catch (err) {
    res.status(502).json({ error: "LB playlist import failed", detail: err.message });
  }
});

apiRouter.get("/listenbrainz/validate", async (req, res) => {
  const token = req.query.token || db.getSettingsRaw().listenBrainzToken;
  if (!token) return res.status(400).json({ error: "No token provided" });
  try {
    const upstream = await safeRequest("https://api.listenbrainz.org/1/validate-token", {
      headers: { "Authorization": `Token ${token}` }
    });
    const data = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json({ error: "Invalid token", detail: data.error });
    res.json({ ok: true, valid: data.valid, username: data.user_name });
  } catch (err) {
    res.status(502).json({ error: "ListenBrainz validation failed", detail: err.message });
  }
});

apiRouter.get("/lastfm/validate", async (req, res) => {
  const apiKey = req.query.apiKey || db.getSettingsRaw().lastFmApiKey;
  if (!apiKey) return res.status(400).json({ error: "No API key provided" });
  try {
    const data = await safeFetchJson(`http://ws.audioscrobbler.com/2.0/?method=chart.gettoptracks&api_key=${apiKey}&format=json&limit=1`);
    if (data.error) throw new Error(data.message);
    res.json({ ok: true, status: "Connected" });
  } catch (err) {
    res.status(400).json({ error: "Last.fm validation failed", detail: err.message });
  }
});

apiRouter.post("/scrobble", async (req, res) => {
  const { track_metadata, tracks, listen_type = "single" } = req.body;
  const settings = db.getSettingsRaw();
  const token = settings.listenBrainzToken;
  if (!token) return res.status(400).json({ error: "ListenBrainz token not configured" });
  try {
    let payload;
    if (listen_type === "single") {
      payload = { listen_type: "single", payload: [{ listened_at: Math.floor(Date.now() / 1000), track_metadata }] };
    } else {
      payload = { listen_type: "import", payload: tracks.map((t, index) => ({ listened_at: Math.floor(Date.now() / 1000) - (tracks.length - index), track_metadata: t })) };
    }
    const upstream = await safeRequest("https://api.listenbrainz.org/1/submit-listens", {
      method: "POST",
      headers: { "Authorization": `Token ${token}`, "Content-Type": "application/json" },
      body: payload
    });
    if (!upstream.ok) return res.status(upstream.status).json({ error: "ListenBrainz error", detail: await upstream.text() });
    res.json({ ok: true, count: listen_type === "import" ? tracks.length : 1 });
  } catch (err) {
    res.status(502).json({ error: "ListenBrainz scrobbling failed", detail: err.message });
  }
});

// Ollama Relay
const OLLAMA_ALLOWED_PATHS = new Set(["/api/generate", "/api/chat", "/api/tags", "/api/show"]);
apiRouter.all("/ollama", async (req, res) => {
  const targetUrl = req.headers["x-ollama-target"];
  const ollamaPath = req.headers["x-ollama-path"];
  if (!targetUrl || !ollamaPath || !OLLAMA_ALLOWED_PATHS.has(ollamaPath)) return res.status(400).json({ error: "Invalid Ollama request" });
  try {
    const parsed = new URL(targetUrl);
    const allowLocal = process.env.ALLOW_LOCAL_NETWORK === "true";
    const host = parsed.hostname.toLowerCase();
    const isPrivate = host === "localhost" || host === "127.0.0.1" || /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(host);
    if (!allowLocal && isPrivate) return res.status(403).json({ error: "Local Ollama blocked" });
    const upstream = await safeRequest(`${targetUrl.replace(/\/$/, "")}${ollamaPath}`, {
      method: req.method,
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      ...(req.method === "POST" ? { body: req.body } : {}),
      timeout: 35000,
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) { res.status(502).json({ error: "Ollama unreachable", detail: err.message }); }
});

// Gotify Relay
apiRouter.post("/gotify", async (req, res) => {
  const GOTIFY_SERVER_URL = process.env.GOTIFY_SERVER_URL;
  if (!GOTIFY_SERVER_URL) return res.status(503).json({ error: "Gotify not configured" });
  const { token, payload } = req.body || {};
  if (!token || !payload) return res.status(400).json({ error: "Missing token/payload" });
  try {
    const upstream = await safeRequest(`${GOTIFY_SERVER_URL}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Gotify-Key": token },
      body: payload,
      timeout: 10000,
    });
    res.status(upstream.status).send(await upstream.text());
  } catch (err) { res.status(502).json({ error: "Gotify unreachable", detail: err.message }); }
});

app.use("/api/v1/library", requireApiKey, apiRouter);

// ── Proxy: /api/live/* → sync-server ─────────────────────────────────────────
//
// This forwards REST calls.  WebSocket upgrade is handled below at the http
// server level so we can stream the TCP connection directly.

app.all("/api/live/*", (req, res) => {
  const targetPath = req.url; // preserves /api/live/push etc.
  const opts = {
    hostname: SYNC_SERVER_HOST.split(":")[0],
    port:     parseInt(SYNC_SERVER_HOST.split(":")[1] || "3001", 10),
    path:     targetPath,
    method:   req.method,
    headers: {
      ...req.headers,
      host: SYNC_SERVER_HOST,
      "x-forwarded-for": req.ip,
    },
  };

  const proxy = http.request(opts, (upstream) => {
    res.writeHead(upstream.statusCode, upstream.headers);
    upstream.pipe(res);
  });

  proxy.on("error", (err) => {
    log.error("proxy:error", { path: targetPath, err: err.message });
    if (!res.headersSent) res.status(502).json({ error: "Sync server unavailable", detail: err.message });
  });

  req.pipe(proxy);
});

// ── API: country code ──────────────────────────────────────────────────────────

app.get("/api/countryCode", (req, res) => {
  const lang = (req.headers["accept-language"] || "en").slice(0, 2).toLowerCase();
  const regionMap = { en: "US", de: "DE", fr: "FR", es: "ES", pt: "BR", ja: "JP", ru: "RU", uk: "UA" };
  res.json({ city: "", country: regionMap[lang] || "US", countryRegion: "", region: regionMap[lang] || "US" });
});

// ── API: SponsorBlock stub ─────────────────────────────────────────────────────

app.get("/api/sponsorBlock", (_req, res) => {
  res.json({ segments: [] });
});

// ── WebSocket upgrade response construction helper ───────────────────────────────

/**
 * Build HTTP upgrade response for WebSocket proxying.
 * Properly handles header values that might contain special characters.
 */
function buildWebSocketUpgradeResponse(upstreamHeaders) {
  const headerLines = [];
  for (const [key, value] of Object.entries(upstreamHeaders)) {
    // Skip headers that shouldn't be forwarded
    if (key === 'transfer-encoding' || key === 'connection') continue;
    // Sanitize header values - remove any newlines to prevent header injection
    const safeValue = String(value).replace(/[\r\n]/g, ' ').trim();
    if (safeValue) {
      headerLines.push(`${key}: ${safeValue}`);
    }
  }
  return `HTTP/1.1 101 Switching Protocols\r\n${headerLines.join('\r\n')}\r\n\r\n`;
}

// ── API: Lyrics proxy (NetEase Cloud Music) ────────────────────────────────────
// Forwards requests to NetEase (music.163.com) which blocks cross-origin browser requests.
// The server makes the request server-side and returns the JSON with CORS headers set.

app.get("/api/lyrics-proxy/netease/search", async (req, res) => {
  const { s, limit } = req.query;
  if (!s) return res.status(400).json({ error: "Missing query param: s" });
  try {
    const url = `https://music.163.com/api/search/get?s=${encodeURIComponent(s)}&type=1&limit=${limit || 5}`;
    const upstream = await safeRequest(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com/" },
      timeout: 6000,
    });
    if (!upstream.ok) return res.status(upstream.status).json({ error: "NetEase search error" });
    const data = await upstream.json();
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "NetEase search failed", detail: err.message });
  }
});

app.get("/api/lyrics-proxy/netease/lyric", async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Missing query param: id" });
  try {
    const url = `https://music.163.com/api/song/lyric?id=${id}&lv=1&kv=1&tv=-1`;
    const upstream = await safeRequest(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com/" },
      timeout: 6000,
    });
    if (!upstream.ok) return res.status(upstream.status).json({ error: "NetEase lyric error" });
    const data = await upstream.json();
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "NetEase lyric fetch failed", detail: err.message });
  }
});

// Helper to sidestep Node 18 native fetch/undici IPv6 resolution bugs
const https = require('https');

/**
 * Robust replacement for fetch that forces IPv4 to avoid Undici bugs.
 */
function safeRequest(url, options = {}) {
  const { method = 'GET', headers = {}, body, timeout = 15000 } = options;
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);

      // Normalize body to string once to avoid double-stringification
      let bodyString = undefined;
      if (body !== undefined) {
        bodyString = typeof body === 'string' ? body : JSON.stringify(body);
      }

      const reqOptions = {
        method,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        headers: {
          ...headers,
          "User-Agent": "Elysium/1.12",
          ...(bodyString !== undefined ? { "Content-Length": Buffer.byteLength(bodyString) } : {})
        },
        family: 4, // Force IPv4
      };

      const client = parsed.protocol === 'https:' ? https : http;
      const req = client.request(reqOptions, (res) => {
        let responseData = '';
        res.on('data', chunk => responseData += chunk);
        res.on('end', () => {
          const result = {
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers: {
              get: (name) => res.headers[name.toLowerCase()],
              getSetCookie: () => res.headers['set-cookie'] || [],
            },
            json: async () => JSON.parse(responseData),
            text: async () => responseData,
          };
          resolve(result);
        });
      });

      req.on('error', (err) => reject(new Error(`Network Error: ${err.message}`)));
      req.setTimeout(timeout, () => { req.destroy(); reject(new Error("Request Timeout")); });

      if (bodyString !== undefined) {
        req.write(bodyString);
      }
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

function safeFetchJson(url) {
  return safeRequest(url).then(r => r.json());
}

// ── API: iTunes / Apple Music proxy ───────────────────────────────────────────
// itunes.apple.com does not send CORS headers — all direct browser requests are
// blocked. The server proxies requests and returns JSON with CORS headers.
// Responses are cached 1 hour (artwork URLs are stable CDN links).


app.get("/api/itunes-proxy/search", async (req, res) => {
  const { term, media, entity, limit, lang } = req.query;
  if (!term) return res.status(400).json({ error: "Missing query param: term" });
  try {
    const params = new URLSearchParams();
    params.set("term", term);
    if (media)  params.set("media",  media);
    if (entity) params.set("entity", entity);
    if (limit)  params.set("limit",  limit);
    if (lang)   params.set("lang",   lang);
    const data = await safeFetchJson(`https://itunes.apple.com/search?${params}`);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(data);
  } catch (err) {
    if (err.message === "429") return res.status(429).json({ error: "iTunes rate limited" });
    res.status(502).json({ error: "iTunes search proxy failed", detail: err.message });
  }
});

app.get("/api/itunes-proxy/lookup", async (req, res) => {
  const { id, entity, limit, sort } = req.query;
  if (!id) return res.status(400).json({ error: "Missing query param: id" });
  try {
    const params = new URLSearchParams();
    params.set("id", id);
    if (entity) params.set("entity", entity);
    if (limit)  params.set("limit",  limit);
    if (sort)   params.set("sort",   sort);
    const data = await safeFetchJson(`https://itunes.apple.com/lookup?${params}`);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "iTunes lookup proxy failed", detail: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// Invidious Helpers
// ═══════════════════════════════════════════════════════════════════════════════
//
// Design: after form login the server captures the SID cookie. That SID is the
// session credential. Every subsequent API call is made server-side by this
// Express server, which injects "Cookie: SID=<value>" on behalf of the browser.
// The browser never talks to Invidious directly — no CORS, no token format issues.
//
// Endpoints:
//   POST /api/invidious/login          – form login, returns { sid, username }
//   GET  /api/invidious/playlists      – list user playlists
//   POST /api/invidious/playlists      – create playlist  { title, privacy }
//   POST /api/invidious/playlists/:id/videos     – add video { videoId }
//   DELETE /api/invidious/playlists/:id/videos/:vid – remove video
//   DELETE /api/invidious/playlists/:id          – delete playlist
// ═══════════════════════════════════════════════════════════════════════════════

/** Validate + normalise an Invidious instance URL. Throws on invalid input. */
function parseInstanceUrl(raw) {
  const base = (raw || "").trim().replace(/\/+$/, "");
  const u = new URL(base); 
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Protocol must be http or https");
  
  // Security: Prevent SSRF by blocking local/private hostnames unless ALLOW_LOCAL_NETWORK is set
  const host = u.hostname.toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "[::1]";
  const isPrivateIp = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(host);
  
  const allowLocal = process.env.ALLOW_LOCAL_NETWORK === "true";

  if (!allowLocal && (isLocal || isPrivateIp)) {
    throw new Error("Local/Private instances are not allowed via this proxy for security reasons (ALLOW_LOCAL_NETWORK=false in server config)");
  }

  return u.origin;
}

/** Make an authenticated request to the Invidious API using a session SID. */
async function invidiousApiCall(instanceBase, sid, path, { method = "GET", body } = {}) {
  const url = `${instanceBase}${path}`;
  const headers = {
    "Cookie":     `SID=${sid}`,
    "User-Agent": "Elysium/1.0",
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await safeRequest(url, {
    method,
    headers,
    body,
    timeout: 15_000,
  });
  return res;
}

// ── POST /api/invidious/login ─────────────────────────────────────────────────
// Body: { instanceUrl, username, password }
// Response: { ok: true, sid, username, instanceUrl }
app.post("/api/invidious/login", async (req, res) => {
  const { instanceUrl, username, password } = req.body || {};
  if (!instanceUrl || !username || !password) {
    return res.status(400).json({ error: "instanceUrl, username and password are required" });
  }

  let base;
  try { base = parseInstanceUrl(instanceUrl); }
  catch (e) { return res.status(400).json({ error: `Invalid instanceUrl: ${e.message}` }); }

  try {
    const formBody = new URLSearchParams({ email: username, password, action: "signin" }).toString();
    const loginRes = await safeRequest(`${base}/login`, {
      method:   "POST",
      headers:  { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Elysium/1.0" },
      body:     formBody,
      timeout:  15_000,
    });

    // Collect Set-Cookie headers
    let cookieStr = loginRes.headers.get("set-cookie") || "";
    if (typeof loginRes.headers.getSetCookie === "function") {
      cookieStr = loginRes.headers.getSetCookie().join("; ");
    }

    // Extract SID value
    const m = cookieStr.match(/(?:^|[;,]\s*)SID=([^;,\s]+)/i);
    if (!m) {
      log.warn("invidious:login:no-sid", { base, status: loginRes.status });
      return res.status(401).json({ error: "Login failed — wrong credentials or login disabled on this instance." });
    }

    const sid = m[1].trim();
    log.info("invidious:login:ok", { base, user: username });
    res.json({ ok: true, sid, username, instanceUrl: base });

  } catch (err) {
    log.error("invidious:login", { err: err.message, base });
    res.status(502).json({ error: "Could not reach Invidious instance", detail: err.message });
  }
});

// ── GET /api/invidious/playlists ──────────────────────────────────────────────
// Headers: X-Invidious-Instance, X-Invidious-SID
// Response: array of Invidious playlist objects
app.get("/api/invidious/playlists", async (req, res) => {
  const settings = db.getSettingsRaw();
  const base = (req.headers["x-invidious-instance"] || settings.invidiousInstance || "").replace(/\/+$/, "");
  const sid  = req.headers["x-invidious-sid"] || settings.invidiousSid || "";
  
  if (!base || !sid) {
    return res.status(401).json({ error: "Invidious instance or session SID not configured" });
  }

  try {
    log.info("invidious:playlists:fetch", { base, sidLen: sid.length });
    const upstream = await invidiousApiCall(base, sid, "/api/v1/auth/playlists");
    const text = await upstream.text();

    if (!upstream.ok) {
      log.warn("invidious:playlists:error", { base, status: upstream.status, body: text.slice(0, 200) });
      return res.status(upstream.status).json({ error: `Invidious returned ${upstream.status}`, detail: text.slice(0, 200) });
    }

    try {
      const data = JSON.parse(text);
      if (data && data.error) {
        log.warn("invidious:playlists:api-error", { base, error: data.error });
        return res.status(502).json({ error: "Invidious API error", detail: data.error });
      }
      // Handle both flat arrays and { playlists: [...] }
      const playlists = Array.isArray(data) ? data : (data.playlists || []);
      log.info("invidious:playlists:success", { base, count: playlists.length });
      res.json(playlists);
    } catch (e) {
      log.error("invidious:playlists:parse-error", { base, err: e.message });
      res.status(500).json({ error: "Failed to parse Invidious response" });
    }
  } catch (err) {
    log.error("invidious:playlists", { err: err.message });
    res.status(502).json({ error: err.message });
  }
});

// ── POST /api/invidious/playlists ─────────────────────────────────────────────
// Headers: X-Invidious-Instance, X-Invidious-SID
// Body: { title, privacy }
// Response: { playlistId }
app.post("/api/invidious/playlists", async (req, res) => {
  const rawBase = (req.headers["x-invidious-instance"] || "").trim();
  const sid     = req.headers["x-invidious-sid"] || "";
  const { title, privacy = "private" } = req.body || {};
  if (!rawBase) return res.status(400).json({ error: "X-Invidious-Instance header required" });
  if (!sid)     return res.status(400).json({ error: "X-Invidious-SID header required" });
  let base;
  try { base = parseInstanceUrl(rawBase); }
  catch (e) { return res.status(400).json({ error: `Invalid X-Invidious-Instance: ${e.message}` }); }
  if (!title) return res.status(400).json({ error: "title is required" });

  try {
    const upstream = await invidiousApiCall(base, sid, "/api/v1/auth/playlists", {
      method: "POST",
      body: { title, privacy },
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      log.warn("invidious:create-playlist:error", { base, status: upstream.status, body: text.slice(0, 200) });
      return res.status(upstream.status).json({ error: `Invidious returned ${upstream.status}`, detail: text.slice(0, 200) });
    }
    res.setHeader("Content-Type", "application/json");
    res.send(text);
  } catch (err) {
    log.error("invidious:create-playlist", { err: err.message });
    res.status(502).json({ error: err.message });
  }
});

// ── POST /api/invidious/playlists/:id/videos ──────────────────────────────────
// Headers: X-Invidious-Instance, X-Invidious-SID
// Body: { videoId }
app.post("/api/invidious/playlists/:id/videos", async (req, res) => {
  const rawBase    = (req.headers["x-invidious-instance"] || "").trim();
  const sid        = req.headers["x-invidious-sid"] || "";
  const playlistId = req.params.id;
  const { videoId } = req.body || {};
  if (!rawBase || !sid) return res.status(400).json({ error: "X-Invidious-Instance and X-Invidious-SID headers required" });
  let base;
  try { base = parseInstanceUrl(rawBase); }
  catch (e) { return res.status(400).json({ error: `Invalid X-Invidious-Instance: ${e.message}` }); }
  if (!videoId) return res.status(400).json({ error: "videoId required" });

  try {
    const upstream = await invidiousApiCall(base, sid, `/api/v1/auth/playlists/${playlistId}/videos`, {
      method: "POST",
      body: { videoId },
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      log.warn("invidious:add-video:error", { base, playlistId, status: upstream.status });
      return res.status(upstream.status).json({ error: `Invidious returned ${upstream.status}`, detail: text.slice(0, 200) });
    }
    res.status(upstream.status).json({ ok: true });
  } catch (err) {
    log.error("invidious:add-video", { err: err.message });
    res.status(502).json({ error: err.message });
  }
});

// ── GET /api/invidious/playlists/:id ──────────────────────────────────────────
// Fetches a single Invidious playlist by ID including its full video list.
// Uses /api/v1/auth/playlists/:id which returns complete video data (unlike
// the list endpoint /api/v1/auth/playlists which returns videos: [] for each).
app.get("/api/invidious/playlists/:id", async (req, res) => {
  const rawBase = (req.headers["x-invidious-instance"] || "").trim();
  const sid     = req.headers["x-invidious-sid"] || "";
  const { id }  = req.params;
  if (!rawBase || !sid) return res.status(400).json({ error: "X-Invidious-Instance and X-Invidious-SID headers required" });
  let base;
  try { base = parseInstanceUrl(rawBase); }
  catch (e) { return res.status(400).json({ error: `Invalid X-Invidious-Instance: ${e.message}` }); }

  try {
    const upstream = await invidiousApiCall(base, sid, `/api/v1/auth/playlists/${id}`);
    const text = await upstream.text();
    if (!upstream.ok) {
      log.warn("invidious:get-playlist:error", { base, id, status: upstream.status });
      return res.status(upstream.status).json({ error: `Invidious returned ${upstream.status}`, detail: text.slice(0, 200) });
    }
    res.setHeader("Content-Type", "application/json");
    res.send(text);
  } catch (err) {
    log.error("invidious:get-playlist", { err: err.message, id });
    res.status(502).json({ error: err.message });
  }
});

// ── DELETE /api/invidious/playlists/:id ──────────────────────────────────────
app.delete("/api/invidious/playlists/:id", async (req, res) => {
  const rawBase = (req.headers["x-invidious-instance"] || "").trim();
  const sid     = req.headers["x-invidious-sid"] || "";
  const { id }  = req.params;
  if (!rawBase || !sid) return res.status(400).json({ error: "X-Invidious-Instance and X-Invidious-SID headers required" });
  let base;
  try { base = parseInstanceUrl(rawBase); }
  catch (e) { return res.status(400).json({ error: `Invalid X-Invidious-Instance: ${e.message}` }); }

  try {
    const upstream = await invidiousApiCall(base, sid, `/api/v1/auth/playlists/${id}`, { method: "DELETE" });
    const text = await upstream.text();
    if (!upstream.ok) {
      log.warn("invidious:delete-playlist:error", { base, id, status: upstream.status });
      return res.status(upstream.status).json({ error: `Invidious returned ${upstream.status}`, detail: text.slice(0, 200) });
    }
    res.status(204).end();
  } catch (err) {
    log.error("invidious:delete-playlist", { err: err.message });
    res.status(502).json({ error: err.message });
  }
});

// ── Sync Invidious Playlist to local DB ──
app.post("/api/invidious/sync-playlist/:id", async (req, res) => {
  const settings = db.getSettingsRaw();
  const base = (req.headers["x-invidious-instance"] || settings.invidiousInstance || "").replace(/\/+$/, "");
  const sid  = req.headers["x-invidious-sid"] || settings.invidiousSid || "";
  const { id } = req.params;

  if (!base || !sid) {
    return res.status(401).json({ error: "Invidious instance or session SID not configured" });
  }

  try {
    log.info("invidious:sync-playlist:start", { base, id });
    const upstream = await invidiousApiCall(base, sid, `/api/v1/auth/playlists/${id}`);
    if (!upstream.ok) {
      const detail = await upstream.text();
      log.warn("invidious:sync-playlist:error", { base, id, status: upstream.status, detail: detail.slice(0, 100) });
      return res.status(upstream.status).json({ error: "Could not fetch Invidious playlist", detail });
    }
    
    const data = await upstream.json();
    log.info("invidious:sync-playlist:parsed", { id, title: data.title, trackCount: (data.videos || []).length });
    const tracks = (data.videos || []).map(v => ({
      id:      v.videoId,
      videoId: v.videoId,
      title:   v.title,
      artist:  v.author,
      artwork: v.videoThumbnails?.find(t => t.quality === "high")?.url || v.videoThumbnails?.[0]?.url,
      duration: v.lengthSeconds,
    }));

    const playlists = db.getPlaylists();
    const existing  = playlists.find(p => p.syncId === id);
    
    let result;
    if (existing) {
      result = db.updatePlaylist(existing.id, { title: data.title, videos: tracks });
    } else {
      result = db.addPlaylist({ title: data.title, videos: tracks, syncId: id });
    }
    res.json(result);
  } catch (err) {
    log.error("invidious:sync-playlist", { err: err.message });
    res.status(502).json({ error: err.message });
  }
});

// ── DELETE /api/invidious/playlists/:id/videos/:vid ───────────────────────────
// NOTE: :vid must be the video's "indexId" field (not videoId) per Invidious API docs.
// See: DELETE /api/v1/auth/playlists/:id/videos/:index
app.delete("/api/invidious/playlists/:id/videos/:vid", async (req, res) => {
  const rawBase     = (req.headers["x-invidious-instance"] || "").trim();
  const sid         = req.headers["x-invidious-sid"] || "";
  const { id, vid } = req.params;
  if (!rawBase || !sid) return res.status(400).json({ error: "X-Invidious-Instance and X-Invidious-SID headers required" });
  let base;
  try { base = parseInstanceUrl(rawBase); }
  catch (e) { return res.status(400).json({ error: `Invalid X-Invidious-Instance: ${e.message}` }); }

  try {
    const upstream = await invidiousApiCall(base, sid, `/api/v1/auth/playlists/${id}/videos/${vid}`, { method: "DELETE" });
    const text = await upstream.text();
    if (!upstream.ok) {
      log.warn("invidious:remove-video:error", { base, id, vid, status: upstream.status, body: text.slice(0, 200) });
      return res.status(upstream.status).json({ error: `Invidious returned ${upstream.status}`, detail: text.slice(0, 200) });
    }
    res.status(204).end();
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── GET /api/invidious/video/:id ──────────────────────────────────────────────
// Resolves full video details and stream URLs for a specific YouTube ID.
app.get("/api/invidious/video/:id", async (req, res) => {
  const base = (req.headers["x-invidious-instance"] || "").trim().replace(/\/+$/, "");
  const sid  = req.headers["x-invidious-sid"] || "";
  if (!base) return res.status(400).json({ error: "X-Invidious-Instance header required" });

  const settings = db.getSettingsRaw();
  const allowedInstance = (settings.invidiousInstance || "").replace(/\/+$/, "");
  
  const publicWhitelist = new Set([
     "https://yt.ikiagi.loseyourip.com",
     "https://yewtu.be",
     "https://vid.puffyan.us",
     "https://invidious.snopyta.org",
     "https://invidious.kavin.rocks",
     "https://invidious.io",
  ]);

  const isAllowed = (allowedInstance && base === allowedInstance) || publicWhitelist.has(base);

  if (!isAllowed) {
    log.warn("invidious:video:ssrf-blocked", { requested: base, allowed: allowedInstance });
    return res.status(403).json({ error: "X-Invidious-Instance is not allowed" });
  }

  try {
    // Invidious API: /api/v1/videos/:id
    // regional hints and local=true help bypass geo-locking and IP-locking.
    const url = `/api/v1/videos/${req.params.id}?local=true`;
    const upstream = await invidiousApiCall(base, sid, url);
    const text = await upstream.text();
    
    if (!upstream.ok) {
      log.warn("invidious:get-video:error", { base, id: req.params.id, status: upstream.status });
      return res.status(upstream.status).json({ error: `Invidious returned ${upstream.status}`, detail: text.slice(0, 200) });
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(text);
  } catch (err) {
    log.error("invidious:get-video", { err: err.message });
    res.status(502).json({ error: err.message });
  }
});

// Deprecated unauthenticated proxy routes were removed to enforce requireApiKey security.

// ── Multi-device sync (legacy + REST) ─────────────────────────────────────────
// Kept for backward-compat with the old 6-digit code flow.

const syncStore = new Map();
const SYNC_TTL_MS = 24 * 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [code, entry] of syncStore.entries()) {
    if (entry.expiresAt < now) { syncStore.delete(code); removed++; }
  }
  if (removed > 0) log.info("sync:cleanup", { removed, remaining: syncStore.size });
}, 30 * 60 * 1000).unref();

const generateSyncCode = () => String(Math.floor(100000 + Math.random() * 900000));

const SYNC_STORE_MAX = 10_000; // DoS guard

app.post("/api/sync/push", (req, res) => {
  const payload = req.body;
  if (!payload || typeof payload !== "object") return res.status(400).json({ error: "Invalid payload" });
  if (JSON.stringify(payload).length > 5 * 1024 * 1024) return res.status(413).json({ error: "Payload too large" });
  if (syncStore.size >= SYNC_STORE_MAX) return res.status(503).json({ error: "Sync store full — try again later" });
  let code, attempts = 0;
  do { code = generateSyncCode(); attempts++; } while (syncStore.has(code) && attempts < 20);
  syncStore.set(code, { payload, expiresAt: Date.now() + SYNC_TTL_MS });
  log.info("sync:push", { code, size: syncStore.size });
  res.json({ code, expiresIn: SYNC_TTL_MS / 1000 });
});

app.get("/api/sync/pull/:code", (req, res) => {
  const entry = syncStore.get(req.params.code);
  if (!entry || entry.expiresAt < Date.now()) {
    syncStore.delete(req.params.code);
    return res.status(404).json({ error: "Code not found or expired" });
  }
  log.info("sync:pull", { code: req.params.code });
  res.json(entry.payload);
});

// Legacy endpoints
app.post("/api/save", (req, res) => {
  const playlists = req.body?.data ?? [];
  let code, attempts = 0;
  do { code = generateSyncCode(); attempts++; } while (syncStore.has(code) && attempts < 20);
  syncStore.set(code, {
    payload: { version: 1, pushedAt: new Date().toISOString(), playlists, history: [], followedArtists: [] },
    expiresAt: Date.now() + SYNC_TTL_MS,
  });
  res.json({ code });
});

app.get("/api/sync/:code", (req, res) => {
  const entry = syncStore.get(req.params.code);
  if (!entry || entry.expiresAt < Date.now()) {
    syncStore.delete(req.params.code);
    return res.status(404).json({ data: [] });
  }
  res.json({ data: entry.payload.playlists ?? [] });
});

// ── Push notification endpoints ────────────────────────────────────────────────

app.get("/push/vapid-public-key", (_req, res) => {
  if (!pushEnabled) return res.status(503).json({ error: "Push notifications not configured" });
  res.json({ key: VAPID_PUBLIC });
});

app.post("/push/subscribe", (req, res) => {
  if (!pushEnabled) return res.status(503).json({ error: "Push notifications not configured" });
  const subscription = req.body;
  if (!subscription?.endpoint) return res.status(400).json({ error: "Invalid subscription object" });
  subscriptions.set(subscription.endpoint, subscription);
  log.info("push:subscribe", { endpoint: subscription.endpoint.slice(0, 60), total: subscriptions.size });
  res.status(201).json({ success: true, total: subscriptions.size });
});

app.post("/push/unsubscribe", (req, res) => {
  if (req.body?.endpoint) subscriptions.delete(req.body.endpoint);
  res.json({ success: true });
});

app.post("/push/broadcast", async (req, res) => {
  if (!pushEnabled) return res.status(503).json({ error: "Push notifications not configured" });
  if (!BROADCAST_SECRET) return res.status(503).json({ error: "Broadcast not available: BROADCAST_SECRET not set" });
  const token = (req.headers["authorization"] || "").startsWith("Bearer ") ? req.headers["authorization"].slice(7) : "";
  if (token !== BROADCAST_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const { title = "Elysium", body = "", icon, url } = req.body;
  const payload = JSON.stringify({ title, body, icon, url });

  const results = await Promise.allSettled(
    [...subscriptions.values()].map((sub) =>
      webpush.sendNotification(sub, payload).catch((err) => {
        if (err.statusCode === 410 || err.statusCode === 404) subscriptions.delete(sub.endpoint);
        throw err;
      })
    )
  );

  const sent   = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;
  log.info("push:broadcast", { sent, failed, total: subscriptions.size });
  res.json({ sent, failed, total: subscriptions.size });
});

// ── Global Error Handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  log.error("express:global-error", { method: req.method, path: req.path, err: err.message, stack: err.stack });
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Internal server error — processing failed", detail: err.message });
});

const staticAssetPattern = /\.(map|js|css|woff2?|ico|png|jpg|jpeg|gif|webp|svg|json)$/i;
app.get("*", (req, res) => {
  if (staticAssetPattern.test(req.path)) {
    if (req.path.endsWith(".map")) {
      res.setHeader("Content-Type", "application/json");
      return res.send('{"version":3,"sources":[],"names":[],"mappings":""}');
    }
    return res.status(404).send("Not found");
  }
  const indexPath = path.join(BUILD_DIR, "index.html");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.sendFile(indexPath, (err) => {
    if (err) {
      log.error("spa:sendFile", { err: err.message, path: indexPath });
      res.status(503).send("Service unavailable – build artefacts not found.");
    }
  });
});

// ── HTTP server + WebSocket upgrade proxy ──────────────────────────────────────

const indexPath = path.join(BUILD_DIR, "index.html");
if (!fs.existsSync(indexPath)) {
  log.warn("start:missing-build", { dir: BUILD_DIR, msg: "Frontend not found. API is running, but UI will return 503." });
}

const server = http.createServer(app);

// Proxy WebSocket upgrades for /api/live/ws to sync-server
server.on("upgrade", (req, socket, head) => {
  if (!req.url.startsWith("/api/live/ws")) {
    socket.destroy();
    return;
  }

  const syncHost   = SYNC_SERVER_HOST.split(":")[0];
  const syncPort   = parseInt(SYNC_SERVER_HOST.split(":")[1] || "3001", 10);

  const upstream = http.request({
    hostname: syncHost,
    port:     syncPort,
    path:     req.url,
    method:   "GET",
    headers:  { ...req.headers, host: SYNC_SERVER_HOST },
  });

  upstream.on("upgrade", (upRes, upSocket, upHead) => {
    const response = buildWebSocketUpgradeResponse(upRes.headers);
    socket.write(response);
    if (upHead && upHead.length) upSocket.unshift(upHead);
    upSocket.pipe(socket);
    socket.pipe(upSocket);
    log.debug("ws:upgrade:proxied", { path: req.url });
  });

  upstream.on("error", (err) => {
    log.error("ws:upgrade:error", { err: err.message });
    socket.destroy();
  });

  upstream.end();
});

server.listen(PORT, () => {
  log.info("started", {
    port: PORT,
    syncProxy: SYNC_SERVER_URL,
    logLevel: LOG_LEVEL_NAME,
    push: pushEnabled,
  });
});

function shutdown(signal) {
  log.info("shutdown", { signal });
  server.close(() => {
    log.info("shutdown:complete");
    process.exit(0);
  });
  setTimeout(() => {
    log.error("shutdown:forced");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  log.error("uncaughtException", { err: err.message, stack: err.stack });
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  log.error("unhandledRejection", { reason: String(reason) });
});
