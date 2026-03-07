/**
 * Elysium Sync Server — real-time relay
 *
 * Responsibilities:
 *  1. PRESENCE  – devices broadcast "now playing" over WebSocket; all linked
 *                 devices receive updates instantly (<50 ms).
 *  2. INSTANT SYNC – a device pushes a full data snapshot; linked devices
 *                 receive it immediately via their open WebSocket connection.
 *                 No poll needed, no 6-digit code ceremony.
 *  3. SSE FALLBACK – for clients that can't hold a WebSocket (rare), a
 *                 Server-Sent Events endpoint streams the same events.
 *  4. REST PULL  – a device can always GET the latest snapshot for a device
 *                 code even if it was offline when the push happened (24 h TTL).
 *
 * Every "device code" is the permanent 8-char code derived client-side from
 * the deviceId.  The server never generates codes; it just routes messages
 * between codes that claim to be "linked".
 *
 * Logging: all log lines are structured JSON so they are easy to grep/parse.
 *   format: {"ts":"ISO","level":"INFO|WARN|ERROR","svc":"sync","msg":"...","...extra}
 *
 * ── ENV ──────────────────────────────────────────────────────────────────────
 *  PORT          HTTP port (default 3001)
 *  SYNC_TTL_MS   Snapshot TTL in ms (default 86400000 = 24 h)
 *  LOG_LEVEL     debug | info | warn | error  (default info)
 */

"use strict";

const http    = require("http");
const fs      = require("fs");
const path    = require("path");
const express = require("express");
const { WebSocketServer, OPEN } = require("ws");

// ── Structured logger ─────────────────────────────────────────────────────────

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_LEVEL = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;

const log = {
  _emit(level, msg, extra = {}) {
    if (LEVELS[level] < LOG_LEVEL) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level: level.toUpperCase(),
      svc: "sync",
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

// ── Constants ─────────────────────────────────────────────────────────────────

const PORT       = Number(process.env.PORT) || 3001;
const SYNC_TTL   = Number(process.env.SYNC_TTL_MS) || 24 * 60 * 60 * 1000;
const PING_MS    = 25_000; // WebSocket keep-alive ping interval

// ── In-memory stores ──────────────────────────────────────────────────────────

/**
 * snapshots: Map<deviceCode, { payload, pushedAt, expiresAt }>
 * Stores the latest full data snapshot per device for offline pull.
 */
const snapshots = new Map();

/**
 * presence: Map<deviceCode, { videoId, title, author, thumbnailUrl, paused, ts }>
 * Stores the current "now playing" state per device.
 */
const presence = new Map();

/**
 * wsClients: Map<deviceCode, Set<WebSocket>>
 * One device may have multiple tabs open — all get events.
 */
const wsClients = new Map();

/**
 * sseClients: Map<deviceCode, Set<Response>>
 * SSE fallback connections.
 */
const sseClients = new Map();

/**
 * confirmedPairs: Map<deviceCode, Set<deviceCode>>
 * Tracks mutually confirmed pairings. Both directions are always set together.
 * Only devices in each other's confirmedPairs set can exchange presence/sync data.
 * Persisted to PAIRS_FILE so pairings survive server restarts.
 */
const PAIRS_FILE      = path.join(process.env.DATA_DIR || __dirname, "confirmed-pairs.json");
const DELETIONS_FILE  = path.join(process.env.DATA_DIR || __dirname, "pending-deletions.json");

const confirmedPairs = new Map();

/**
 * pendingDeletions: Map<targetCode, Array<{playlistSyncId, playlistTitle, videoId, fromCode, deletedAt}>>
 * Stores deletion events for offline devices. Flushed to the device on reconnect.
 * Persisted to DELETIONS_FILE so they survive server restarts.
 */
const pendingDeletions = new Map();

// Load persisted pairs on startup
try {
  if (fs.existsSync(PAIRS_FILE)) {
    const raw = JSON.parse(fs.readFileSync(PAIRS_FILE, "utf8"));
    for (const [code, peers] of Object.entries(raw)) {
      confirmedPairs.set(code, new Set(peers));
    }
    log.info("pairs:loaded", { count: confirmedPairs.size, file: PAIRS_FILE });
  }
} catch (err) {
  log.warn("pairs:load-failed", { err: String(err) });
}

// Load persisted pending deletions on startup
try {
  if (fs.existsSync(DELETIONS_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DELETIONS_FILE, "utf8"));
    for (const [code, items] of Object.entries(raw)) {
      if (Array.isArray(items) && items.length) pendingDeletions.set(code, items);
    }
    log.info("deletions:loaded", { count: pendingDeletions.size, file: DELETIONS_FILE });
  }
} catch (err) {
  log.warn("deletions:load-failed", { err: String(err) });
}

function persistPairs() {
  try {
    const obj = {};
    for (const [code, peers] of confirmedPairs) {
      obj[code] = [...peers];
    }
    fs.writeFileSync(PAIRS_FILE, JSON.stringify(obj, null, 2), "utf8");
  } catch (err) {
    log.warn("pairs:persist-failed", { err: String(err) });
  }
}

function persistDeletions() {
  try {
    const obj = {};
    for (const [code, items] of pendingDeletions) {
      obj[code] = items;
    }
    fs.writeFileSync(DELETIONS_FILE, JSON.stringify(obj, null, 2), "utf8");
  } catch (err) {
    log.warn("deletions:persist-failed", { err: String(err) });
  }
}

function addConfirmedPair(codeA, codeB) {
  if (!confirmedPairs.has(codeA)) confirmedPairs.set(codeA, new Set());
  if (!confirmedPairs.has(codeB)) confirmedPairs.set(codeB, new Set());
  confirmedPairs.get(codeA).add(codeB);
  confirmedPairs.get(codeB).add(codeA);
  persistPairs();
}

function removeConfirmedPair(codeA, codeB) {
  confirmedPairs.get(codeA)?.delete(codeB);
  confirmedPairs.get(codeB)?.delete(codeA);
  persistPairs();
}

function arePaired(codeA, codeB) {
  return confirmedPairs.get(codeA)?.has(codeB) ?? false;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Send a JSON message to all WebSocket clients registered for a device code. */
function broadcastToCode(targetCode, message) {
  const sockets = wsClients.get(targetCode);
  if (!sockets || sockets.size === 0) return 0;
  const raw = JSON.stringify(message);
  let sent = 0;
  for (const ws of sockets) {
    if (ws.readyState === OPEN) {
      ws.send(raw);
      sent++;
    }
  }
  return sent;
}

/** Send an SSE event to all SSE clients registered for a device code. */
function sseToCode(targetCode, event, data) {
  const clients = sseClients.get(targetCode);
  if (!clients || clients.size === 0) return 0;
  const raw = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  let sent = 0;
  for (const res of clients) {
    try { res.write(raw); sent++; } catch { /* client gone */ }
  }
  return sent;
}

/** Deliver a message to a target device via WS and SSE. */
function deliver(targetCode, message) {
  const ws  = broadcastToCode(targetCode, message);
  const sse = sseToCode(targetCode, message.type, message);
  return ws + sse;
}

function registerWs(code, ws) {
  if (!wsClients.has(code)) wsClients.set(code, new Set());
  wsClients.get(code).add(ws);
  log.debug("ws:register", { code, total: wsClients.get(code).size });
}

function unregisterWs(code, ws) {
  const set = wsClients.get(code);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) wsClients.delete(code);
  log.debug("ws:unregister", { code, remaining: set.size });
}

// Periodic snapshot cleanup
setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [code, entry] of snapshots.entries()) {
    if (entry.expiresAt < now) { snapshots.delete(code); removed++; }
  }
  if (removed > 0) log.info("snapshot:cleanup", { removed, remaining: snapshots.size });
}, 15 * 60 * 1000).unref();

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: "8mb" }));

// CORS – allow same-origin and local dev
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Device-Code");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// ── Health ─────────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    snapshots: snapshots.size,
    wsConnections: [...wsClients.values()].reduce((n, s) => n + s.size, 0),
    sseConnections: [...sseClients.values()].reduce((n, s) => n + s.size, 0),
  });
});

// ── REST: instant push ────────────────────────────────────────────────────────
/**
 * POST /api/live/push
 * Body: { deviceCode, linkedCodes: string[], payload: SyncPayload }
 *
 * Stores snapshot for offline pull AND delivers immediately to all online
 * linked devices.
 */
app.post("/api/live/push", (req, res) => {
  const { deviceCode, linkedCodes, payload } = req.body || {};
  if (!deviceCode || !payload) {
    return res.status(400).json({ error: "deviceCode and payload required" });
  }
  if (JSON.stringify(payload).length > 8 * 1024 * 1024) {
    return res.status(413).json({ error: "Payload too large (max 8 MB)" });
  }

  // Store snapshot
  snapshots.set(deviceCode, {
    payload,
    pushedAt: new Date().toISOString(),
    expiresAt: Date.now() + SYNC_TTL,
  });

  // Immediate delivery to all linked devices that are online
  const targets = Array.isArray(linkedCodes) ? linkedCodes : [];
  let delivered = 0;
  for (const code of targets) {
    const n = deliver(code, {
      type: "sync:data",
      fromCode: deviceCode,
      payload,
      ts: new Date().toISOString(),
    });
    delivered += n;
    log.debug("sync:push:deliver", { to: code, connections: n });
  }

  log.info("sync:push", {
    from: deviceCode,
    targets: targets.length,
    delivered,
    snapshots: snapshots.size,
  });

  res.json({ ok: true, delivered, targets: targets.length });
});

// ── REST: pull snapshot ────────────────────────────────────────────────────────
/**
 * GET /api/live/pull/:deviceCode
 * Returns the latest snapshot stored for that device code.
 */
app.get("/api/live/pull/:deviceCode", (req, res) => {
  const { deviceCode } = req.params;
  const entry = snapshots.get(deviceCode);
  if (!entry || entry.expiresAt < Date.now()) {
    snapshots.delete(deviceCode);
    return res.status(404).json({ error: "No snapshot available for this device" });
  }
  log.info("sync:pull", { code: deviceCode });
  res.json({ ok: true, pushedAt: entry.pushedAt, payload: entry.payload });
});

// ── REST: broadcast presence ──────────────────────────────────────────────────
/**
 * POST /api/live/presence
 * Body: { deviceCode, linkedCodes: string[], presence: PresenceState }
 * REST fallback for presence push (WS preferred).
 */
app.post("/api/live/presence", (req, res) => {
  const { deviceCode, linkedCodes, presence: state } = req.body || {};
  if (!deviceCode) return res.status(400).json({ error: "deviceCode required" });

  if (state) {
    presence.set(deviceCode, { ...state, ts: new Date().toISOString() });
  } else {
    presence.delete(deviceCode);
  }

  const targets = Array.isArray(linkedCodes) ? linkedCodes : [];
  let delivered = 0;
  for (const code of targets) {
    delivered += deliver(code, {
      type: "presence:update",
      fromCode: deviceCode,
      presence: state ?? null,
      ts: new Date().toISOString(),
    });
  }

  log.debug("presence:post", { from: deviceCode, targets: targets.length, delivered });
  res.json({ ok: true, delivered });
});

// ── REST: remote control ──────────────────────────────────────────────────────
/**
 * POST /api/live/control
 * Body: { fromCode, targetCode, command: "play"|"pause"|"next"|"prev" }
 */
app.post("/api/live/control", (req, res) => {
  const { fromCode, targetCode, command } = req.body || {};
  if (!fromCode || !targetCode || !command) {
    return res.status(400).json({ error: "fromCode, targetCode and command required" });
  }

  const delivered = deliver(targetCode, {
    type: "remote:control",
    fromCode,
    command,
    ts: new Date().toISOString(),
  });

  log.info("remote:control", { from: fromCode, to: targetCode, command, delivered });
  res.json({ ok: true, delivered });
});

// ── SSE endpoint ──────────────────────────────────────────────────────────────
/**
 * GET /api/live/events?deviceCode=XXXX-XXXX
 * Streams events as Server-Sent Events for clients that can't hold a WS.
 */
app.get("/api/live/events", (req, res) => {
  const deviceCode = req.query.deviceCode;
  if (!deviceCode) return res.status(400).end("deviceCode required");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.flushHeaders();

  // Send a keepalive comment every 20 s
  const keepalive = setInterval(() => {
    try { res.write(": keepalive\n\n"); } catch { cleanup(); }
  }, 20_000);

  if (!sseClients.has(deviceCode)) sseClients.set(deviceCode, new Set());
  sseClients.get(deviceCode).add(res);
  log.info("sse:connect", { code: deviceCode, total: sseClients.get(deviceCode).size });

  function cleanup() {
    clearInterval(keepalive);
    sseClients.get(deviceCode)?.delete(res);
    if (sseClients.get(deviceCode)?.size === 0) sseClients.delete(deviceCode);
    log.info("sse:disconnect", { code: deviceCode });
  }

  req.on("close",  cleanup);
  req.on("error",  cleanup);
  res.on("finish", cleanup);
});

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer(app);

// ── WebSocket server ──────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server, path: "/api/live/ws" });

wss.on("connection", (ws, req) => {
  // Expect first message to be { type: "register", deviceCode }
  let deviceCode = null;
  let pingTimer  = null;

  // Keep-alive ping
  pingTimer = setInterval(() => {
    if (ws.readyState === OPEN) ws.ping();
  }, PING_MS);

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch {
      log.warn("ws:parse-error", { raw: raw.toString().slice(0, 100) });
      return;
    }

    switch (msg.type) {
      // ── Registration ──────────────────────────────────────────────────────
      case "register": {
        if (deviceCode) unregisterWs(deviceCode, ws);
        deviceCode = msg.deviceCode;
        if (!deviceCode) { ws.close(1008, "deviceCode required"); return; }
        registerWs(deviceCode, ws);
        ws.send(JSON.stringify({ type: "registered", deviceCode }));
        log.info("ws:registered", { code: deviceCode, ip: req.socket.remoteAddress });

        // Flush any pending video deletions queued while this device was offline.
        // Must happen AFTER registerWs so deliver() finds the socket.
        const pendingDels = pendingDeletions.get(deviceCode);
        if (pendingDels && pendingDels.length) {
          for (const del of pendingDels) {
            deliver(deviceCode, {
              type: "playlist:video:delete",
              fromCode: del.fromCode,
              playlistSyncId: del.playlistSyncId,
              playlistTitle:  del.playlistTitle,
              videoId: del.videoId,
              ts: del.deletedAt,
            });
          }
          log.info("deletions:flushed", { to: deviceCode, count: pendingDels.length });
          pendingDeletions.delete(deviceCode);
          persistDeletions();
        }

        // Only notify devices that have a confirmed mutual pairing with this device.
        // Never broadcast to all connected devices — that would leak presence to strangers.
        const now = new Date().toISOString();
        const peers = confirmedPairs.get(deviceCode) ?? new Set();
        for (const otherCode of peers) {
          if (!wsClients.has(otherCode)) continue;
          // Notify the paired peer that this device is back online
          deliver(otherCode, { type: "peer:online", fromCode: deviceCode, ts: now });
          // Tell this device about its paired peer + their current presence
          const cachedPresence = presence.get(otherCode) ?? null;
          ws.send(JSON.stringify({ type: "peer:online", fromCode: otherCode, presence: cachedPresence, ts: now }));
        }
        break;
      }

      // Relay pair request to target device. Does NOT add to confirmedPairs yet —
      // that only happens when the target explicitly sends pair:accept.
      case "pair:request": {
        if (!deviceCode) return;
        const { targetCode, senderName, senderPlatform } = msg;
        if (!targetCode) return;
        const pairDelivered = deliver(targetCode, {
          type: "pair:request",
          fromCode: deviceCode,
          senderName: senderName || "Unknown Device",
          senderPlatform: senderPlatform || "other",
          ts: new Date().toISOString(),
        });
        ws.send(JSON.stringify({ type: "pair:ack", targetCode, delivered: pairDelivered, ts: new Date().toISOString() }));
        log.info("ws:pair:request", { from: deviceCode, to: targetCode, delivered: pairDelivered });
        break;
      }

      // Target device accepted the pair request — add to confirmedPairs and notify both sides.
      case "pair:accept": {
        if (!deviceCode) return;
        const { targetCode, acceptorName } = msg;
        if (!targetCode) return;
        addConfirmedPair(deviceCode, targetCode);
        // Notify the requester that pairing is confirmed, including our name so
        // they can display a meaningful label instead of a generated fallback.
        deliver(targetCode, {
          type: "pair:confirmed",
          fromCode: deviceCode,
          acceptorName: acceptorName || null,
          ts: new Date().toISOString(),
        });
        // Also confirm back to the acceptor (they already know our name from pair:request)
        ws.send(JSON.stringify({ type: "pair:confirmed", fromCode: targetCode, ts: new Date().toISOString() }));
        log.info("ws:pair:accepted", { acceptor: deviceCode, requester: targetCode });
        break;
      }

      // Either device revokes — remove from confirmedPairs and notify the other side.
      case "pair:revoke": {
        if (!deviceCode) return;
        const { targetCode } = msg;
        if (!targetCode) return;
        removeConfirmedPair(deviceCode, targetCode);
        deliver(targetCode, {
          type: "pair:revoked",
          fromCode: deviceCode,
          ts: new Date().toISOString(),
        });
        log.info("ws:pair:revoked", { by: deviceCode, target: targetCode });
        break;
      }

      // ── Presence broadcast ────────────────────────────────────────────────
      case "presence:update": {
        if (!deviceCode) return;
        const state = msg.presence ?? null;
        if (state) {
          presence.set(deviceCode, { ...state, ts: new Date().toISOString() });
        }
        const targets = Array.isArray(msg.linkedCodes) ? msg.linkedCodes : [];
        // Only deliver to devices that have a confirmed mutual pairing
        for (const code of targets) {
          if (!arePaired(deviceCode, code)) continue;
          deliver(code, {
            type: "presence:update",
            fromCode: deviceCode,
            presence: state,
            ts: new Date().toISOString(),
          });
        }
        log.debug("ws:presence", { from: deviceCode, targets: targets.length });
        break;
      }

      // ── Instant data sync ─────────────────────────────────────────────────
      case "sync:push": {
        if (!deviceCode) return;
        const { payload, linkedCodes } = msg;
        if (!payload) return;
        snapshots.set(deviceCode, {
          payload,
          pushedAt: new Date().toISOString(),
          expiresAt: Date.now() + SYNC_TTL,
        });
        const targets = Array.isArray(linkedCodes) ? linkedCodes : [];
        let delivered = 0;
        // Only deliver to devices with a confirmed mutual pairing
        for (const code of targets) {
          if (!arePaired(deviceCode, code)) continue;
          delivered += deliver(code, {
            type: "sync:data",
            fromCode: deviceCode,
            payload,
            ts: new Date().toISOString(),
          });
        }
        log.info("ws:sync:push", { from: deviceCode, targets: targets.length, delivered });
        // Ack
        ws.send(JSON.stringify({ type: "sync:ack", delivered, ts: new Date().toISOString() }));
        break;
      }

      // ── Playlist video deletion propagation ───────────────────────────────
      // Device A deleted a video. If target is online, deliver immediately.
      // If offline, queue in pendingDeletions for flush on their next reconnect.
      case "playlist:video:delete": {
        if (!deviceCode) return;
        const { targetCode: delTargetCode, playlistSyncId, playlistTitle, videoId } = msg;
        if (!delTargetCode || !videoId) return;
        if (!arePaired(deviceCode, delTargetCode)) return;
        const deleteMsg = {
          type: "playlist:video:delete",
          fromCode: deviceCode,
          playlistSyncId: playlistSyncId || "",
          playlistTitle:  playlistTitle  || "",
          videoId,
          ts: new Date().toISOString(),
        };
        const reached = deliver(delTargetCode, deleteMsg);
        if (reached === 0) {
          // Target is offline — queue for later delivery on their next reconnect
          if (!pendingDeletions.has(delTargetCode)) pendingDeletions.set(delTargetCode, []);
          pendingDeletions.get(delTargetCode).push({
            playlistSyncId: playlistSyncId || "",
            playlistTitle:  playlistTitle  || "",
            videoId,
            fromCode: deviceCode,
            deletedAt: new Date().toISOString(),
          });
          persistDeletions();
          log.debug("deletion:queued", { for: delTargetCode, videoId });
        }
        log.info("ws:video:delete", { from: deviceCode, to: delTargetCode, videoId, reached });
        break;
      }

      // ── Remote control ────────────────────────────────────────────────────
      case "remote:control": {
        if (!deviceCode) return;
        const { targetCode, command } = msg;
        if (!targetCode || !command) return;
        const delivered = deliver(targetCode, {
          type: "remote:control",
          fromCode: deviceCode,
          command,
          ts: new Date().toISOString(),
        });
        log.info("ws:remote", { from: deviceCode, to: targetCode, command, delivered });
        break;
      }

      default:
        // Silently ignore keep-alive pings (empty object {}) and other unknown frames
        if (msg.type) log.warn("ws:unknown-type", { type: msg.type, code: deviceCode });
    }
  });

  ws.on("close", (code, reason) => {
    clearInterval(pingTimer);
    if (deviceCode) {
      unregisterWs(deviceCode, ws);
      log.info("ws:close", { code: deviceCode, closeCode: code, reason: reason.toString() });
      // Only notify confirmed paired devices that this device went offline
      if (!wsClients.has(deviceCode)) {
        const now = new Date().toISOString();
        const peers = confirmedPairs.get(deviceCode) ?? new Set();
        for (const otherCode of peers) {
          deliver(otherCode, { type: "peer:offline", fromCode: deviceCode, ts: now });
        }
        log.debug("ws:peer-offline-broadcast", { code: deviceCode, notified: peers.size });
      }
    }
  });

  ws.on("error", (err) => {
    log.warn("ws:error", { code: deviceCode, err: err.message });
  });

  ws.on("pong", () => {
    log.debug("ws:pong", { code: deviceCode });
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  log.info("started", { port: PORT, logLevel: process.env.LOG_LEVEL || "info" });
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
  }, 8000).unref();
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
