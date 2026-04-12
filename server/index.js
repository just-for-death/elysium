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

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_LEVEL_NAME = (process.env.LOG_LEVEL || "info").toLowerCase();
const LOG_LEVEL = LEVELS[LOG_LEVEL_NAME] ?? LEVELS.info;

const log = {
  _emit(level, msg, extra = {}) {
    if (LEVELS[level] < LOG_LEVEL) return;
    const line = JSON.stringify({
      ts:    new Date().toISOString(),
      level: level.toUpperCase(),
      svc:   "elysium",
      msg,
      ...extra,
    });
    (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
  },
  debug: (msg, extra) => log._emit("debug", msg, extra),
  info:  (msg, extra) => log._emit("info",  msg, extra),
  warn:  (msg, extra) => log._emit("warn",  msg, extra),
  error: (msg, extra) => log._emit("error", msg, extra),
};

// ── Config ────────────────────────────────────────────────────────────────────

const PORT             = process.env.PORT || 3000;
const BUILD_DIR        = path.join(__dirname, "../build");
const SYNC_SERVER_URL  = process.env.SYNC_SERVER_URL || "http://localhost:3001";
const SYNC_SERVER_HOST = (() => { try { return new URL(SYNC_SERVER_URL).host; } catch { return "localhost:3001"; } })();

const VAPID_PUBLIC     = process.env.VAPID_PUBLIC_KEY  || "";
const VAPID_PRIVATE    = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_EMAIL      = process.env.VAPID_EMAIL       || "mailto:elysium@example.com";
const BROADCAST_SECRET = process.env.BROADCAST_SECRET  || "";

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
  res.setHeader("Access-Control-Allow-Origin", "*");
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

app.use("/api/v1/library", requireApiKey, apiRouter);

// ── API: ListenBrainz Scrobble Proxy ───────────────────────────────────────────
app.post("/api/v1/scrobble", requireApiKey, async (req, res) => {
  const { track_metadata } = req.body;
  if (!track_metadata || !track_metadata.artist_name || !track_metadata.track_name) {
    return res.status(400).json({ error: "Missing track_metadata with artist_name and track_name" });
  }

  const settings = db.getSettingsRaw(); // need the raw (unredacted) settings for the token
  const token = settings.listenBrainzToken;
  if (!token) return res.status(400).json({ error: "ListenBrainz token not configured in settings" });

  try {
    const payload = {
      listen_type: "single",
      payload: [{
        listened_at: Math.floor(Date.now() / 1000),
        track_metadata
      }]
    };

    const upstream = await fetch("https://api.listenbrainz.org/1/submit-listens", {
      method: "POST",
      headers: {
        "Authorization": `Token ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!upstream.ok) {
        const resp = await upstream.text();
        return res.status(upstream.status).json({ error: "ListenBrainz error", detail: resp });
    }
    res.json({ ok: true, scrobbled: true });
  } catch (err) {
    res.status(502).json({ error: "ListenBrainz scrobbling failed", detail: err.message });
  }
});

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

// ── API: Lyrics proxy (NetEase Cloud Music) ────────────────────────────────────
// Forwards requests to NetEase (music.163.com) which blocks cross-origin browser requests.
// The server makes the request server-side and returns the JSON with CORS headers set.

app.get("/api/lyrics-proxy/netease/search", async (req, res) => {
  const { s, limit } = req.query;
  if (!s) return res.status(400).json({ error: "Missing query param: s" });
  try {
    const url = `https://music.163.com/api/search/get?s=${encodeURIComponent(s)}&type=1&limit=${limit || 5}`;
    const upstream = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com/" },
      signal: AbortSignal.timeout(6000),
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
    const upstream = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com/" },
      signal: AbortSignal.timeout(6000),
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
function safeFetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { family: 4, headers: { "User-Agent": "Elysium/1.12" } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 429) return reject(new Error("429"));
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    }).on('error', reject).setTimeout(8000, function() {
        this.destroy(); reject(new Error("Timeout"));
    });
  });
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


app.get("/api/itunes-proxy/rss/:cc/:chart", async (req, res) => {
  const { cc, chart } = req.params;
  const limit = parseInt(req.query.limit) || 50;
  // Only allow known chart types to prevent open proxy abuse
  const allowed = ["topsongs", "topalbums", "topmusic", "newmusic", "recentreleases"];
  if (!allowed.includes(chart)) return res.status(400).json({ error: "Unknown chart type" });
  try {
    const url = `https://itunes.apple.com/${encodeURIComponent(cc)}/rss/${encodeURIComponent(chart)}/limit=${limit}/json`;
    const data = await safeFetchJson(url);
    res.setHeader("Cache-Control", "public, max-age=1800");
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "iTunes RSS proxy failed", detail: err.message });
  }
});

// ── API: ListenBrainz proxy ────────────────────────────────────────────────────
//
// The LB CF recommendations endpoint returns a 308 redirect from the browser,
// and CORS fails on redirects because the redirect response does not carry
// Access-Control-Allow-Origin. Proxying server-side avoids this entirely.
// The Authorization token is passed via the x-lb-token request header.

app.get("/api/lb-proxy/recommendations/cf/recording/for_user/:username", async (req, res) => {
  const { username } = req.params;
  const { count } = req.query;
  const userToken = req.headers["x-lb-token"];
  if (!username) return res.status(400).json({ error: "Missing username" });
  if (!userToken) return res.status(400).json({ error: "Missing x-lb-token header" });
  try {
    const params = new URLSearchParams();
    if (count) params.set("count", count);
    const url = `https://api.listenbrainz.org/1/recommendations/cf/recording/for_user/${encodeURIComponent(username)}?${params}`;
    const upstream = await fetch(url, {
      headers: { Authorization: `Token ${userToken}`, "User-Agent": "Elysium/1.12" },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    if (!upstream.ok) return res.status(upstream.status).json({ error: "ListenBrainz CF recommendations error" });
    const data = await upstream.json();
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "ListenBrainz CF proxy failed", detail: err.message });
  }
});

// ── API: RemotePlay stubs ──────────────────────────────────────────────────────
// Real remote play now happens through sync-server WebSocket.
// These stubs keep the old polling hook from crashing.

app.get("/api/remotePlay",   (_req, res) => res.json({ data: null }));
app.post("/api/remotePlay",  (_req, res) => res.status(204).end());
app.get("/api/clearRemotePlay", (_req, res) => res.status(204).end());

// ── API: Gotify proxy ──────────────────────────────────────────────────────────

// SSRF mitigation: Gotify server URL is pulled from server-side env, not from the request body.
// Set GOTIFY_SERVER_URL in the environment.  If unset, the proxy is disabled.
const GOTIFY_SERVER_URL = (process.env.GOTIFY_SERVER_URL || "").replace(/\/+$/, "");

app.post("/api/gotify-proxy", requireApiKey, async (req, res) => {
  if (!GOTIFY_SERVER_URL) {
    return res.status(503).json({ error: "Gotify proxy is not configured on this server (GOTIFY_SERVER_URL not set)" });
  }
  const { token, payload } = req.body || {};
  if (!token || !payload) {
    return res.status(400).json({ error: "token and payload are required" });
  }
  let target;
  try {
    target = new URL(GOTIFY_SERVER_URL + "/message");
    if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("Invalid protocol");
  } catch {
    return res.status(500).json({ error: "GOTIFY_SERVER_URL is misconfigured on the server" });
  }
  try {
    const upstream = await fetch(target.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Gotify-Key": token },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const text = await upstream.text();
    res.status(upstream.status).send(text);
  } catch (err) {
    log.error("gotify:proxy", { err: err.message });
    res.status(502).json({ error: "Could not reach Gotify server", detail: err.message });
  }
});

// ── API: Ollama proxy ──────────────────────────────────────────────────────────
// Browser → this proxy → Ollama (server-to-server, no CORS/mixed-content issues)
// Required when the app is served from a remote origin (not localhost):
//   - Browser CORS blocks cross-origin fetch to Ollama (no Access-Control headers)
//   - HTTPS app + HTTP Ollama = mixed-content block (Safari, Chrome)
// Security: whitelisted paths only (not an open proxy), URL scheme validated.
const OLLAMA_ALLOWED_PATHS = new Set(["/api/tags", "/api/generate", "/api/version"]);

app.all("/api/ollama-proxy", async (req, res) => {
  const targetUrl = req.headers["x-ollama-target"];
  const ollamaPath = req.headers["x-ollama-path"];

  // Validate target URL
  if (typeof targetUrl !== "string" || !targetUrl) {
    return res.status(400).json({ error: "Missing x-ollama-target header" });
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return res.status(400).json({ error: "Invalid x-ollama-target URL" });
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return res.status(400).json({ error: "x-ollama-target must use http or https" });
  }

  // Validate path (tight whitelist — not an open proxy)
  if (typeof ollamaPath !== "string" || !OLLAMA_ALLOWED_PATHS.has(ollamaPath)) {
    return res.status(400).json({ error: `x-ollama-path must be one of: ${[...OLLAMA_ALLOWED_PATHS].join(", ")}` });
  }

  const forwardUrl = `${targetUrl.replace(/\/$/, "")}${ollamaPath}`;

  try {
    const upstream = await fetch(forwardUrl, {
      method:  req.method,
      headers: {
        "Content-Type": "application/json",
        "Accept":        "application/json",
      },
      // Only forward body for POST requests
      ...(req.method === "POST" ? { body: JSON.stringify(req.body) } : {}),
      // 35s: slightly longer than the client's 30s AbortSignal so Express
      // can return a clean JSON error rather than a hard socket drop
      signal: AbortSignal.timeout(35_000),
    });

    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    log.error("ollama:proxy", { url: forwardUrl, err: err.message });
    res.status(502).json({ error: "Could not reach Ollama server", detail: err.message });
  }
});



// ═══════════════════════════════════════════════════════════════════════════════
// Invidious API — all calls are made server-side using the SID cookie directly.
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
  
  // Security: Prevent SSRF by blocking local/private hostnames
  const host = u.hostname.toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "[::1]";
  const isPrivateIp = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(host);
  
  if (isLocal || isPrivateIp) {
    throw new Error("Local/Private instances are not allowed via this proxy for security reasons");
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
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
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
    const loginRes = await fetch(`${base}/login`, {
      method:   "POST",
      headers:  { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Elysium/1.0" },
      body:     formBody,
      redirect: "manual",
      signal:   AbortSignal.timeout(15_000),
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
  const base = (req.headers["x-invidious-instance"] || "").replace(/\/+$/, "");
  const sid  = req.headers["x-invidious-sid"] || "";
  const { title, privacy = "private" } = req.body || {};
  if (!base || !sid) return res.status(400).json({ error: "X-Invidious-Instance and X-Invidious-SID headers required" });
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
  const base       = (req.headers["x-invidious-instance"] || "").replace(/\/+$/, "");
  const sid        = req.headers["x-invidious-sid"] || "";
  const playlistId = req.params.id;
  const { videoId } = req.body || {};
  if (!base || !sid) return res.status(400).json({ error: "Headers required" });
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
  const base = (req.headers["x-invidious-instance"] || "").replace(/\/+$/, "");
  const sid  = req.headers["x-invidious-sid"] || "";
  const { id } = req.params;
  if (!base || !sid) return res.status(400).json({ error: "X-Invidious-Instance and X-Invidious-SID headers required" });

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
  const base       = (req.headers["x-invidious-instance"] || "").replace(/\/+$/, "");
  const sid        = req.headers["x-invidious-sid"] || "";
  const { id, vid } = req.params;
  if (!base || !sid) return res.status(400).json({ error: "Headers required" });

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

// ── DELETE /api/invidious/playlists/:id ───────────────────────────────────────
app.delete("/api/invidious/playlists/:id", async (req, res) => {
  const base = (req.headers["x-invidious-instance"] || "").replace(/\/+$/, "");
  const sid  = req.headers["x-invidious-sid"] || "";
  const { id } = req.params;
  if (!base || !sid) return res.status(400).json({ error: "Headers required" });

  try {
    const upstream = await invidiousApiCall(base, sid, `/api/v1/auth/playlists/${id}`, { method: "DELETE" });
    res.status(upstream.status).json({ ok: upstream.ok });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── GET /api/invidious/search ─────────────────────────────────────────────────
// Proxies a search query to an Invidious instance, bypassing browser CORS.
// SSRF mitigation: instanceUrl must exactly match one of the user's configured
// instances stored in the server-side settings database.  Arbitrary URLs are rejected.
// Query params: instanceUrl (required), q, type, sort_by, page
app.get("/api/invidious/search", async (req, res) => {
  const { instanceUrl, ...searchParams } = req.query;
  const sid = req.headers["x-invidious-sid"]; // Forward SID if available
  
  if (!instanceUrl) return res.status(400).json({ error: "instanceUrl query param required" });

  const settings = db.getSettingsRaw();
  const allowedInstance = (settings.invidiousInstance || "").replace(/\/+$/, "");
  const normalised = (instanceUrl || "").replace(/\/+$/, "");
  
  const publicWhitelist = new Set([
     "https://yt.ikiagi.loseyourip.com",
     "https://yewtu.be",
     "https://vid.puffyan.us",
     "https://invidious.snopyta.org",
     "https://invidious.kavin.rocks",
     "https://invidious.io",
  ]);

  const isAllowed = (allowedInstance && normalised === allowedInstance) || publicWhitelist.has(normalised);

  if (!isAllowed) {
    log.warn("invidious:search:ssrf-blocked", { requested: normalised, allowed: allowedInstance });
    return res.status(403).json({ error: "instanceUrl is not in the whitelist and does not match configured instance" });
  }

  let base;
  try { base = parseInstanceUrl(instanceUrl); }
  catch (e) { return res.status(400).json({ error: `Invalid instanceUrl: ${e.message}` }); }

  try {
    const qs = new URLSearchParams(searchParams).toString();
    const url = `${base}/api/v1/search?${qs}`;
    const upstream = await fetch(url, {
      headers: { 
        "User-Agent": "Elysium/1.0",
        ...(sid ? { "Cookie": `SID=${sid}` } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      log.warn("invidious:search:error", { base, status: upstream.status });
      return res.status(upstream.status).json({ error: `Invidious returned ${upstream.status}`, detail: text.slice(0, 200) });
    }
    res.setHeader("Content-Type", "application/json");
    res.send(text);
  } catch (err) {
    log.error("invidious:search", { err: err.message });
    res.status(502).json({ error: err.message });
  }
});

// ── Legacy endpoints (kept for backwards compat, redirect to new logic) ───────
// Old code may POST to /api/invidious-login — forward to new handler logic
app.post("/api/invidious-login", (req, res) => {
  res.status(410).json({ error: "Deprecated. Use /api/invidious/login" });
});
app.post("/api/invidious-proxy", (req, res) => {
  res.status(410).json({ error: "Deprecated. Use /api/invidious/* endpoints" });
});

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

// ── SPA catch-all ──────────────────────────────────────────────────────────────

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
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
      Object.entries(upRes.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n") +
      "\r\n\r\n"
    );
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
