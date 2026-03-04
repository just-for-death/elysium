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
 * linkedBy: Map<deviceCode, Set<deviceCode>>
 * Tracks which devices have declared this code as one of their linkedCodes.
 * Used to deliver presence/sync to devices that haven't fully paired yet.
 */
const linkedBy = new Map();

function addLinkedBy(targetCode, fromCode) {
  if (!linkedBy.has(targetCode)) linkedBy.set(targetCode, new Set());
  linkedBy.get(targetCode).add(fromCode);
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
        // When a device registers, tell it about all currently-connected peers
        // (with their cached presence so it instantly knows what they're playing),
        // and tell each peer that this device just came online.
        const now = new Date().toISOString();
        for (const [otherCode] of wsClients) {
          if (otherCode === deviceCode) continue;
          // Notify existing peer that this device is back online
          deliver(otherCode, { type: "peer:online", fromCode: deviceCode, ts: now });
          // Tell the newly-connected device about this peer + their current presence
          const cachedPresence = presence.get(otherCode) ?? null;
          ws.send(JSON.stringify({ type: "peer:online", fromCode: otherCode, presence: cachedPresence, ts: now }));
        }
        break;
      }

      // Bidirectional pairing: Device A sends pair:request targeting Device B.
      // Server relays it to B so B can auto-add A to its linked list.
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

      // ── Presence broadcast ────────────────────────────────────────────────
      case "presence:update": {
        if (!deviceCode) return;
        const state = msg.presence ?? null;
        if (state) {
          presence.set(deviceCode, { ...state, ts: new Date().toISOString() });
        }
        // null presence = heartbeat: device is online but not playing. Keep last presence.
        // Don't delete presence on null - just means "nothing playing right now"
        const targets = Array.isArray(msg.linkedCodes) ? msg.linkedCodes : [];
        // Register reverse links so the server knows who is linked to whom
        for (const code of targets) addLinkedBy(code, deviceCode);
        // Deliver to explicit targets
        const delivered = new Set();
        for (const code of targets) {
          deliver(code, {
            type: "presence:update",
            fromCode: deviceCode,
            presence: state,
            ts: new Date().toISOString(),
          });
          delivered.add(code);
        }
        // Also deliver to any device that has declared this device as linked
        const reverseTargets = linkedBy.get(deviceCode) ?? new Set();
        for (const code of reverseTargets) {
          if (!delivered.has(code)) {
            deliver(code, {
              type: "presence:update",
              fromCode: deviceCode,
              presence: state,
              ts: new Date().toISOString(),
            });
          }
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
        for (const code of targets) addLinkedBy(code, deviceCode);
        const syncDelivered = new Set();
        let delivered = 0;
        for (const code of targets) {
          delivered += deliver(code, {
            type: "sync:data",
            fromCode: deviceCode,
            payload,
            ts: new Date().toISOString(),
          });
          syncDelivered.add(code);
        }
        // Also push to any device that listed this one as linked
        const reverseTargets = linkedBy.get(deviceCode) ?? new Set();
        for (const code of reverseTargets) {
          if (!syncDelivered.has(code)) {
            delivered += deliver(code, {
              type: "sync:data",
              fromCode: deviceCode,
              payload,
              ts: new Date().toISOString(),
            });
          }
        }
        log.info("ws:sync:push", { from: deviceCode, targets: targets.length, delivered });
        // Ack
        ws.send(JSON.stringify({ type: "sync:ack", delivered, ts: new Date().toISOString() }));
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
      // If this device has NO remaining connections, notify all other devices it's offline
      if (!wsClients.has(deviceCode)) {
        const now = new Date().toISOString();
        for (const [otherCode] of wsClients) {
          deliver(otherCode, { type: "peer:offline", fromCode: deviceCode, ts: now });
        }
        log.debug("ws:peer-offline-broadcast", { code: deviceCode });
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
